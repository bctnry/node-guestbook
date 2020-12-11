const fs = require('fs');
const http = require('http');
const path = require('path');

const title = 'Guestbook';
const port = 9981;
const rateLimitDurationMS = 1000 * 60 * 60;
const maxCount = 10;
const pageSize = 10;

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

const parseArgs = (urlString) => {
    let x = urlString.split('?');
    if (x.length <= 1) { return {root: x}; }
    let args = {};
    x[1].split('&').forEach((v) => {
        let z = v.split('=');
        if (z.length <= 1) { args[z[0]] = true; }
        else {
            let data = z[1].replace(/%(..)/g, (v) => String.fromCharCode(parseInt(v.substring(1), 16)));
            args[z[0]] = data;
        }
    });
    return {
        root: x[0],
        args
    };
}

const _deEscape = (x) => x.replace(/\\(.)/g, '$1');

const _reg = (n, str) => {
    return `${'0'.repeat(n-str.length)}${str}`;
}
const getCurrentDaystring = () => {
    let date = new Date(Date.now());
    return `${date.getFullYear()}${date.getMonth()+1}${date.getDate()}${_reg(2,date.getHours())}${_reg(2,date.getMinutes())}${_reg(2,date.getSeconds())}`;
}


// db
let db = JSON.parse(fs.readFileSync(path.join('db', 'db.txt'), {encoding:'utf-8'}));
function _flushdb() {
    fs.writeFileSync(path.join('db', 'db.txt'), JSON.stringify(db));
}

// css
let css = fs.readFileSync(path.join('style', 'style.css'));

// markup
function _Markup(source) {
    source = (source
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*((?:\\\*|\\\\|[^* ])+)\*/g, (_, p1) => `<b>${_deEscape(p1)}</b>`)
        .replace(/\/((?:\\\/|\\\\|[^/ ])+)\//g, (_, p1) => `<i>${_deEscape(p1)}</i>`)
        .replace(/`((?:\\\`|\\\\|[^` ])+)`/g, (_, p1) => `<code>${_deEscape(p1)}</code>`)
        .replace(/\[((?:\\\[|\\\]|[^\[\] ])*)\]\(((?:\\\(|\\\)|[^()])*)*\)/g, (_, p1, p2) => `<a href="${_deEscape(p1)}">${_deEscape(p2)}</a>`)
    );

    let res = ['<p>'];
    let pStarted = true;
    source.split('\n').forEach((v) => {
        if (!v.trim() && pStarted) {
            pStarted = false;
            res.push('</p>');
            return;
        }
        if (!pStarted && v.trim()) {
            pStarted = true;
            res.push('<p>');
            res.push(v);
            return;
        }
        res.push(v);
    });
    return res.join('');
}

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
${_Markup(comment.content)}
</div>
</div>
`
}

function _Page(commentList, pageNum) {
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
${_PageSelector(pageNum)}
${_CommentForm()}
</body>
`;
}

function _PageSelector(pageNum) {
    let totalPageCount = Math.ceil(db.comment.length / pageSize);
    let prevPage = `<a href="?page=${pageNum-1}">&lt;</a>`;
    let noPrevPage = `<span style="color:gray">&lt;</span>`
    let nextPage = `<a href="?page=${pageNum+1}">&gt;</a>`;
    let noNextPage = `<span style="color:gray">&gt;</span>`
    let prevLink_ = [];
    for (let i = 1; i < pageNum; i++) {
        prevLink_.push(`<a href="?page=${i}">${i}</a>`);
    }
    let nextLink_ = [];
    for (let i = pageNum+1; i <= totalPageCount; i++) {
        nextLink_.push(`<a href="?page=${i}">${i}</a>`);
    }
    let center = `${prevLink_.join(' ')}${pageNum}${nextLink_.join(' ')}`;
    return `
<div class="page-selector">
${pageNum-1<1?noPrevPage:prevPage} ${center} ${pageNum+1>totalPageCount?noNextPage:nextPage}
</div>
`;
}

function _CommentForm() {
    return `
<div class="comment-form">
<form method="POST" action="">
Name: <br /><input type="text" name="name" id="comment-name"> <br />
Email: <br /><input type="text" name="email" id="comment-name"> <br />
Homepage: <br /><input type="text" name="url" id="comment-name"> <br />
Comment:<br />
<textarea name="content""></textarea><br />
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
            form.date = getCurrentDaystring();
            db.comment.push(form);
            let x = parseArgs(req.url);
            let page = parseInt((x.args && x.args.page) || '1', 10);
            res.end(_Page(db.comment.sort((a, b) => b.id - a.id).slice((page-1)*pageSize, page*pageSize), page));
            _flushdb();
        });
    } else if (req.method === 'GET') {
        let x = parseArgs(req.url);
        let page = parseInt((x.args && x.args.page) || '1', 10);
        res.statusCode = 200;
        res.end(_Page(db.comment.sort((a, b) => b.id - a.id).slice((page-1)*pageSize, page*pageSize), page));
    } else {
        res.statusCode = 400;
        res.end('Method not allowed');
    }
    
});

server.listen(port);
log(`Listening on port ${port}`);
