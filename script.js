//creating our main server.

//ecstatic module that handles requests whose handlers are not specified in the function

const { createServer } = require('http');
const Router = require('./router');
const ecstatic = require('ecstatic');

let router = new Router();
let defaultHeaders = {'Content-Type': 'text/plain'}
class SkillShareServer {
    constructor(talks) {
        this.talks = talks;
        this.version = 0;
        this.waiting;
        let fileServer = ecstatic({ root: './Public' });
        this.server = createServer((request, response) => {
            let resolved = router.resolve(this, request);
            if(resolved) {
                resolved.catch(error => {
                    if(error.status != null) throw error;
                    else return {body: String(error), status: 500}; 
                }).then(({body, status = 200, headers = defaultHeaders}) => {
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
talkPath = /^\/talks\/[^\/]/;
router.add('GET', talkPath, async (server, title) => {
    if(title in server.talks) {
        return {body: JSON.stringify(server.talks[title]), headers: {'Content-Type': 'application/json'}};
    }else {
        return {status: 404, body: `No talk ${title} found`};
    }
});

router.add('DELETE', talkPath, async (server, title) => {
    if(title in server.talks) {
        delete server.talks[title];
        server.updated();
    }
    return {status: 204};
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
    try {talk = JSON.parse(requestBody);
    } catch(_) { return {status: 400, body: 'Invalid JSON'}; }

    if(!talk || typeof talk.presenter != 'string' || typeof talk.summary != 'string') {
        return {status: 400, body: 'Bad talk data'};
    }
    server.talks[title] = {title,
        presenter: talk.presenter,
        summary: talk.summary,
        comments: []
    };
    server.updated();
    return {status: 204}
})