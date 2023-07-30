//creating our main server.

//ecstatic module that handles requests whose handlers are not specified in the function

const { createServer } = require('http');
const Router = require('../router');
const ecstatic = require('ecstatic');

let router = new Router();
let defaultHeaders = { 'Content-Type': 'text/plain' }
class SkillShareServer {
    constructor(talks) {
        this.talks = talks;
        this.version = 0;
        this.waiting;
        let fileServer = ecstatic({ root: './Public' });
        this.server = createServer((request, response) => {
            let resolved = router.resolve(this, request);
            if (resolved) {
                resolved.catch(error => {
                    if (error.status != null) throw error;
                    else return { body: String(error), status: 500 };
                }).then(({ body, status = 200, headers = defaultHeaders }) => {
                    response.writeHead(status, headers);
                    response.end(body);
                });
            } else {
                fileServer(request, response);
            }
        });
    }
    start(port) {
        this.server.listen(port);
    }
    stop() {
        this.server.close();
    }
}



//getting all talks from the talks objects which contain various talk titles
const talkPath = /^\/talks\/[^\/]+$/;
router.add('GET', talkPath, async (server, title) => {
    if (title in server.talks) {
        return { body: JSON.stringify(server.talks[title]), headers: { 'Content-Type': 'application/json' } };
    } else {
        return { status: 404, body: `No talk ${title} found` };
    }
});

router.add('DELETE', talkPath, async (server, title) => {
    if (title in server.talks) {
        delete server.talks[title];
        server.updated();
    }
    return { status: 204 };
});

//retrieving content from a request body
//the put handler reads the request body
function readStream(stream) {
    return new Promise((resolve, reject) => {
        let data = '';
        stream.on('error', reject);
        stream.on('data', chunk => data += chunk.toString());
        stream.on('end', () => resolve(data));
    });
}

//validating data, setting a new talks tite, updating the server

router.add('PUT', talkPath, async (server, title, request) => {
    let requestBody = await readStream(request);
    let talk;
    try {
        talk = JSON.parse(requestBody);
    } catch (_) { return { status: 400, body: 'Invalid JSON' }; }

    if (!talk || typeof talk.presenter != 'string' || typeof talk.summary != 'string') {
        return { status: 400, body: 'Bad talk data' };
    }
    server.talks[title] = {
        title,
        presenter: talk.presenter,
        summary: talk.summary,
        comments: []
    };
    server.updated();
    return { status: 204 }
})

//comments works in a similar way as 

router.add('POST', /^\/talks\/[^\/]+\/comments$/, async (server, title, request) => {
    let requestBody = readStream(request);
    let comment;
    try {
        comment = JSON.parse(requestBody);
    } catch (_) { return { status: 400, body: 'Invalid JSON' }; };

    if (!comment || typeof comment.author != 'string' ||
        typeof comment.message != 'string') {
        return { status: 400, body: 'Bad Talk data' }
    } else if (title in server.talks) {
        server.talks[title].comments.push(comment);
        server.updated();
        return { status: 204 };
    } else { return { status: 404, body: 'No talk title found' } };
});

//long polling support
//there will be multiple places which we have to send an array of talks to the client
//talkResponse is the helper function that does that (also contains the ETag header)

SkillShareServer.prototype.talkResponse = function () {
    let talks = [];
    for (let title of Object.keys(this.talks)) {
        talks.push(this.talks[title]);
    }
    return {
        body: JSON.stringify(talks),
        headers: {
            'Content-Type': 'application/json',
            'ETag': `${this.version}`,
            'Cache-Control': 'no-store'
        }
    };
}

router.add('GET', /^\/talks$/, async (server, request) => {
    let tag = /"(.*)"/.exec(request.headers['if-none-match']);
    let wait = /\bwait=(\d+)/.exec(request.headers['prefer']);
    if (!tag || tag[1] != server.version) {
        return server.talkResponse();
    } else if (!wait) {
        return { status: 304 };
    } else {
        return server.waitForChanges(Number(wait[1]));
    }
});

//callback functions for delayed request are stored in the server's waiting array so 
//that they can be notified when something happens

SkillShareServer.prototype.waitForChanges = function (time) {
    return new Promise(resolve => {
        this.waiting.push(resolve);
        setTimeout(() => {
            if (!this.waiting.includes(resolve)) return;
            this.waiting = this.waiting.filter(r => r != resolve);
            resolve({ status: 304 });
        }, time * 1000);
    });
}

SkillShareServer.prototype.updated = function () {
    this.version++;
    let response = this.talkResponse();
    this.waiting.forEach(resolve => resolve(response));
    this.waiting = [];
}

new SkillShareServer(Object.create(null)).start(8080);

//client
//the application state consists of the list of talks and the name of the user

function handleActions(state, action) {
    if (action.type == 'setUser') {
        localStorage.setItem('userName', action.user);
        return Object.assign({}, state, { user: action.user });
    } else if (action.type == 'setTalks') {
        return Object.assign({}, state, { talks: action.talks });
    } else if (action.type == 'newTalk') {
        fetchOK(talkURL(action.title), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                presenter: state.user,
                summary: action.summary
            })
        }).catch(reportError);
    } else if (action.type == 'deleteTalk') {
        fetchOK(talkURL(action.talk), { method: 'DELETE' })
            .catch(reportError);
    } else if (action.type == 'newComment') {
        fetchOK(talkURL(action.talk) + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                author: state.user,
                message: action.message
            })
        }).catch(reportError);
    }
    return state;
}

function fetchOK(url, option) {
    return fetch(url, option).then(response => {
        if (response.status < 400) return response;
        else throw new Error(response.statusText);
    });
}

function talkURL(title) {
    return 'talks/' + encodeURIComponent(title);
}

function reportError(error) {
    alert(String(error));
}

//rendering components

function elt(node, properties, children) {
    let dom = document.createElement(node);
    for (let prop of Object.keys(properties)) {
        Object.assign({}, dom, { prop: properties[prop] });
    }
    for (let child of children) {
        if (child != 'string') dom.appendChild(child);
        else dom.appendChild(document.createTextNode(child));
    }
    return dom;
}

function renderUserField(name, dispatch) {
    return elt('label', {}, 'Your Name: ', elt('input', {
        type: 'text',
        value: name,
        onchange(event) {
            dispatch({ type: 'setUser', user: event.target.value })
        }
    }));
}

function renderTalk(talk, dispatch) {
    return elt(
        'section', { className: 'talk' },
        elt('h2', null, talk.title, ' ', elt('button', {
            type: 'button',
            onclick() {
                dispatch({ type: 'deleteTalk', talk: talk.title });
            }
        }, 'Delete')),
        elt('div', null, 'by ',
            elt('strong', null, talk.presenter)),
        elt('p', null, talk.summary),
        ...talk.comments.map(renderComment),
        elt('form', {
            onsubmit(event) {
                event.preventDefault();
                let form = event.target;
                dispatch({
                    type: 'newComment',
                    talk: talk.title,
                    message: form.elements.comment.value
                });
                form.reset();
            }
        }, elt('input', { type: 'text', name: 'comment' }), ' ',
            elt('button', { type: 'submit' }, 'Add comment')));
}

function renderComment(comment) {
    return elt('p', {className: 'comment'},
            elt('strong', null, comment.author),
            ': ', comment.message);
}

//form that user can use to create a new talk is rendered as below

function renderTalkForm(dispatch) {
    let title = elt('input', {type: 'text'});
    let summary = elt('input', {type: 'text'});
    return elt('form', {
        onsubmit(event) {
            event.preventDefault();
            dispatch({type: 'newTalk',
                        title: title.value,
                        summary: summary.value});
            event.target.reset();
        }
    }, elt('h3', null, 'Submit a Talk'),
        elt('label', null, 'Title: ', title),
        elt('label', null, 'Summary: ', summary),
        elt('button', {type: 'submit'}, 'Submit'));
}

//writing a function that keeps polling the server for talks
//and calls a callback function when a new set of talks is available
async function pollTalks(update) {
    let tag = undefined;
    for(;;) {
        let response;
        try {
            response = await fetchOK('/talks', {
                headers: tag && {'If-None-Match': tag,
                                'Prefer': 'wait=90'}
            });
        } catch(e) {
            console.log('Request failed: ' + e);
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
        }
        if(response.status == 304) continue;
        tag = response.headers.get('ETag');
        update(await response.json());
    }
}