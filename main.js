const fs = require('fs');
const http = require('http');
const path = require('path');

const title = 'Guestbook';
const port = 9981;
const rateLimitDurationMS = 1000 * 60 * 60;
const maxCount = 20;

// aux funcs.
const log = (str) => {
    console.log(`[${new Date(Date.now()).toISOString()}] ${str}`);
}
const error = (x) => {
    console.error(`[${new Date(Date.now()).toISOString()}] ${x}`);
}

const parseForm = (formString) => {
    let res = {};
    formString.split('&').forEach((x) => {
        let z = x.split('=');
        let data = z[1].replace(/%(..)/g, (v) => String.fromCharCode(parseInt(v.substring(1), 16))).replace(/\+/g, ' ');
        res[z[0]] = data;
    });
    return res;
}


// db
let db = JSON.parse(fs.readFileSync(path.join('db', 'db.txt'), {encoding:'utf-8'}));
function _flushdb() {
    fs.writeFileSync(path.join('db', 'db.txt'), JSON.stringify(db));
}

// css
let css = fs.readFileSync(path.join('style', 'style.css'));

// renderer
function _Date(datestring) {
    return `${datestring.substring(0,4)}.${parseInt(datestring.substring(4,6), 10)}.${parseInt(datestring.substring(6,8), 10)} ${datestring.substring(8,10)}:${datestring.substring(10,12)}:${datestring.substring(12,14)}`;
}

function _Comment(comment) {
    let emailString = (comment.email&&comment.email.trim())? `<a href="mailto:${comment.email.trim()}">${comment.email.trim()}</a>`:'';
    let urlString = (comment.url&&comment.url.trim())? `<a href="${comment.url.trim()}">${comment.url.trim()}</a>`:'';
    return `
<div class="comment">
<div class="comment-header">#${comment.id} <b>${comment.name}@${comment.ip}</b> &lt;${emailString}&gt; {${urlString}} @ ${_Date(comment.date)}</div>
<div class="comment-content">
${comment.content}
</div>
</div>
`
}

function _Page(commentList) {
    return `
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<h1>${title}</h1>
<div class="comment-list">
${commentList.map((v) => _Comment(v)).join('<hr />')}
</div>
${_CommentForm()}
</body>
`;
}

function _CommentForm() {
    return `
<div class="comment-form">
<form method="POST" action="">
Name: <input type="text" name="name" id="comment-name"> <br />
Email: <input type="text" name="email" id="comment-name"> <br />
Homepage: <input type="text" name="url" id="comment-name"> <br />
Comment:<br />
<textarea name="content"></textarea><br />
<input type="submit" value="Comment">
</form>
</div>
`;
}

// rate limit.
const RATE_LIMIT = {};
function _recorded(ip) {
    return !(RATE_LIMIT[ip] === undefined || RATE_LIMIT[ip] === null);
}
function _record(ip) {
    if (!_recorded(ip)) {
        RATE_LIMIT[ip] = 1;
        setTimeout(() => {
            delete RATE_LIMIT[ip];
        }, rateLimitDurationMS);
    } else {
        RATE_LIMIT[ip]++;
    }
}
function _guard(ip) {
    return RATE_LIMIT[ip] > maxCount;
}


// request handler
const server = http.createServer((req, res) => {
    log(`(${req.socket.remoteAddress}) ${req.method} ${req.url}`);

    if (req.method === 'POST') {
        if (_recorded(req.socket.remoteAddress) && _guard(req.socket.remoteAddress)) {
            res.statusCode = 400;
            res.end('Rate limit exceeded. Please check again later.');
            return;
        }
        _record(req.socket.remoteAddress);

        let incomeData = [];
        req.on('data', (data) => {
            incomeData.push(data);
        });
        req.on('end', () => {
            let data = incomeData.join('');
            let form = parseForm(data);
            form.ip = req.socket.remoteAddress;
            form.id = db.id++;
            let d = new Date(Date.now());
            form.date = `${d.getFullYear()}${d.getMonth()}`
            db.comment.push(form);
            res.end(_Page(db.comment));
        });
    } else if (req.method === 'GET') {
        res.statusCode = 200;
        res.end(_Page(db.comment));
    } else {
        res.statusCode = 400;
        res.end('Method not allowed');
    }
    
});

server.listen(port);
log(`Listening on port ${port}`);
