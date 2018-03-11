"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AliOssSerializer_1 = require("./AliOssSerializer");
const stream_1 = require("stream");
const webdav_server_1 = require("webdav-server");
const ali_oss_1 = require("ali-oss");
const DEBUG = require("debug");
const async = require("async");
const debug = DEBUG('oss');
class AliOssFileSystem extends webdav_server_1.v2.FileSystem {
    constructor(region, bucket, accessKeyId, accessKeySecret) {
        super(new AliOssSerializer_1.AliOssSerializer());
        this.region = region;
        this.bucket = bucket;
        this.accessKeyId = accessKeyId;
        this.accessKeySecret = accessKeySecret;
        this.properties = {};
        this.cache = {};
        this.client = new ali_oss_1.Wrapper({ region, bucket, accessKeyId, accessKeySecret });
    }
    _get(path, callback) {
        let url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        this._list({
            prefix: url,
            delimiter: '/'
        }, [], (err, resources) => {
            if (err)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            let dir = url + (url.endsWith('/') ? '' : '/');
            let f = resources.filter(r => (r.path === url || r.path === dir));
            if (f.length === 1) {
                return callback(null, f[0]);
            }
            else {
                callback(webdav_server_1.v2.Errors.ResourceNotFound);
            }
        });
    }
    _list(options, data, callback) {
        this.client.list(options).then(res => {
            let e;
            if (res.statusCode === 404)
                e = webdav_server_1.v2.Errors.ResourceNotFound;
            data = data.concat((res.objects && res.objects.length > 0) ?
                res.objects.map(obj => ({
                    name: obj.name.split('/').splice(-2).join(''),
                    path: obj.name,
                    size: obj.size,
                    url: obj.url,
                    etag: obj.etag,
                    last_modified: obj.lastModified,
                    storage_class: obj.storageClass,
                    storage_type: obj.type,
                    type: obj.name.endsWith('/') ? webdav_server_1.v2.ResourceType.Directory : webdav_server_1.v2.ResourceType.File,
                    _links: {
                        self: obj.url
                    }
                })) : [], (res.prefixes && res.prefixes.length > 0) ?
                res.prefixes.map(obj => ({
                    name: obj.split('/').splice(-2).join(''),
                    path: obj,
                    size: 0,
                    type: webdav_server_1.v2.ResourceType.Directory,
                })) : []);
            if (res.nextMarker) {
                options.marker = res.nextMarker;
                this._list(options, data, callback);
            }
            else {
                callback(e, data);
            }
        }).catch(e => {
            callback(e);
        });
    }
    _parse(path, callback) {
        let url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        this._list({
            prefix: url,
            delimiter: '/'
        }, [], (err, resources) => {
            if (path.isRoot()) {
                return callback(err, resources);
            }
            if (err)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            let dir = url + (url.endsWith('/') ? '' : '/');
            let f = resources.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length === 1) {
                if (f[0].type.isFile) {
                    return callback(null, f[0]);
                }
                else {
                    return this._list({ 'prefix': f[0].path, delimiter: '/', marker: f[0].path }, [], callback);
                }
            }
            else if (f.length > 1) {
                return callback(null, f);
            }
            else {
                callback(webdav_server_1.v2.Errors.ResourceNotFound);
            }
        });
    }
    _openReadStream(path, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        let oKey = path.toString();
        oKey = oKey.startsWith('/') ? oKey.slice(1) : oKey;
        this.client.getStream(oKey).then(res => { callback(null, res.stream); }).catch(callback);
    }
    _openWriteStream(path, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        const wStream = new stream_1.Transform({
            transform(chunk, encoding, cb) {
                cb(null, chunk);
            }
        });
        let oKey = path.toString();
        oKey = oKey.startsWith('/') ? oKey.slice(1) : oKey;
        this.client.putStream(oKey, wStream).then(debug).catch(e => {
            wStream.emit('error', e);
        });
        callback(null, wStream);
    }
    _lockManager(path, ctx, callback) {
        debug('EXEC: _lockManager', path.toString());
        callback(null, new webdav_server_1.v2.LocalLockManager());
    }
    _propertyManager(path, ctx, callback) {
        debug('EXEC: _propertyManager', path.toString());
        this._get(path, (err, data) => {
            if (err || !data)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            let props = new webdav_server_1.v2.LocalPropertyManager();
            for (let prop in data) {
                props[prop] = data[prop];
            }
            return callback(null, props);
        });
    }
    _readDir(path, ctx, callback) {
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        if (!path.isRoot())
            dir = url + (url.endsWith('/') ? '' : '/');
        this._list({
            prefix: dir,
            marker: dir,
            delimiter: '/'
        }, [], (err, resources) => {
            if (err)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            callback(null, resources.map(r => r.path));
        });
    }
    _create(path, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        if (ctx.type.isDirectory) {
            dir = url + (url.endsWith('/') ? '' : '/');
            this.client.put(dir, Buffer.alloc(0)).then(rs => (callback())).catch(callback);
        }
        else {
            debug('Create:', path);
            callback();
        }
    }
    _delete(path, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        this._list({ prefix: url }, [], (err, data) => {
            if (err)
                return callback(err);
            if (data.length === 0)
                return callback();
            let dir = url + (url.endsWith('/') ? '' : '/');
            let f = data.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length == 0)
                return callback();
            this.client.deleteMulti(f.map(r => r.path), { quiet: true }).then(res => { callback(); }).then(callback);
        });
    }
    _rename(path, name, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        this._type(path, { context: ctx.context }, (err, type) => {
            if (err)
                return callback(err);
            if (!type)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            let from = path.toString(), to = path.paths.slice(0, -1).join('/');
            from = from.startsWith('/') ? from.slice(1) : from;
            to = to + (to.endsWith('/') ? '' : '/') + name;
            if (type.isDirectory) {
                from += from.endsWith('/') ? '' : '/';
                to += to.endsWith('/') ? '' : '/';
                this._list({ prefix: from }, [], (err, objs) => {
                    if (err)
                        return callback(err);
                    let actions = objs.map(o => ({ from: o.path, to: to + o.path.slice(from.length) }));
                    async.eachLimit(actions, 10, (action, done) => {
                        this.client.copy(action.to, action.from).then(() => { done(); }).catch(done);
                    }, err => {
                        if (err)
                            return callback(err);
                        this.client.deleteMulti(actions.map(a => a.from), { quiet: true }).then(() => { callback(); }).catch(e => {
                            callback(e);
                        });
                    });
                });
            }
            else {
                this.client.copy(to, from).then(res => {
                    this._delete(path, { context: ctx.context, depth: -1 }, callback);
                }).catch(callback);
            }
        });
    }
    _move(from, to, ctx, callback) {
        if (from.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        let fName = from.paths.slice(-1).join(''), tName = to.paths.slice(-1).join('');
        if (fName !== tName && from.paths.slice(0, -1).join('/') === to.paths.slice(1, -1).join('/')) {
            return this._rename(from, tName, { context: ctx.context, destinationPath: to }, callback);
        }
        else {
            this._type(from, { context: ctx.context }, (err, type) => {
                if (err)
                    return callback(err);
                if (!type)
                    return callback(webdav_server_1.v2.Errors.ResourceNotFound);
                let srcPath = from.toString(), destPath = to.paths.slice(1).join('/');
                srcPath = srcPath.startsWith('/') ? srcPath.slice(1) : srcPath;
                destPath = destPath.startsWith('/') ? destPath.slice(1) : destPath;
                if (type.isDirectory) {
                    srcPath += srcPath.endsWith('/') ? '' : '/';
                    destPath += destPath.endsWith('/') ? '' : '/';
                    this._list({ prefix: srcPath }, [], (err, objs) => {
                        if (err)
                            return callback(err);
                        let actions = objs.map(o => ({ from: o.path, to: destPath + o.path.slice(srcPath.length) }));
                        async.eachLimit(actions, 10, (action, done) => {
                            this.client.copy(action.to, action.from).then(() => { done(); }).catch(done);
                        }, err => {
                            if (err)
                                return callback(err);
                            this.client.deleteMulti(actions.map(a => a.from), { quiet: true }).then(() => { callback(); }).catch(e => {
                                callback(e);
                            });
                        });
                    });
                }
                else {
                    console.log(destPath, srcPath);
                    this.client.copy(destPath, srcPath).then(res => {
                        console.log(res);
                        this._delete(from, { context: ctx.context, depth: 1 }, callback);
                    }).catch(callback);
                }
            });
        }
    }
    _size(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, undefined);
        this._get(path, (err, resource) => {
            if (err || !resource)
                return callback(err || webdav_server_1.v2.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? undefined : resource.size);
        });
    }
    _etag(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, undefined);
        this._get(path, (err, resource) => {
            if (err || !resource)
                return callback(err || webdav_server_1.v2.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? undefined : resource.etag);
        });
    }
    _creationDate(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, Date.now());
        this._get(path, (err, resource) => {
            if (err || !resource)
                return callback(err || webdav_server_1.v2.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? Date.now() : new Date(resource.last_modified).getTime());
        });
    }
    _lastModifiedDate(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, Date.now());
        this._get(path, (err, resource) => {
            if (err || !resource)
                return callback(err || webdav_server_1.v2.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? Date.now() : new Date(resource.last_modified).getTime());
        });
    }
    _displayName(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, '/');
        this._get(path, (err, resource) => {
            if (err || !resource)
                return callback(err || webdav_server_1.v2.Errors.ResourceNotFound);
            return callback(null, resource.name);
        });
    }
    _type(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, webdav_server_1.v2.ResourceType.Directory);
        this._get(path, (e, data) => {
            if (e)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            callback(e, data ? data.type : null);
        });
    }
}
exports.AliOssFileSystem = AliOssFileSystem;
