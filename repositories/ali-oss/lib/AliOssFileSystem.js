"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AliOssSerializer_1 = require("./AliOssSerializer");
const webdav_server_1 = require("webdav-server");
const request = require("request");
const ali_oss_1 = require("ali-oss");
const DEBUG = require("debug");
const XmlBuilder = require("xml-js-builder");
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
    _list(options, data, callback) {
        this.client.list(options).then(res => {
            let e;
            debug('_list:', res);
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
            debug('Data:', data);
            if (res.nextMarker) {
                options.marker = res.nextMarker;
                this._list(options, data, callback);
            }
            else {
                callback(e, data);
            }
        }).catch(e => {
            debug('ERROR:', e);
            callback(e);
        });
    }
    _parse(path, callback) {
        debug('EXEC: _parse', path);
        debug('EXEC:isROOT ?', path.isRoot());
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
            debug('List:', resources);
            let dir = url + (url.endsWith('/') ? '' : '/');
            let f = resources.filter(r => (r.path === url || r.path.startsWith(dir)));
            debug('List:Filter:', f);
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
        debug('EXEC: _openReadStream', path.toString());
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        this._parse(path, (e, data) => {
            if (e)
                return callback(e);
            if (data.constructor === Array)
                return callback(webdav_server_1.v2.Errors.InvalidOperation);
            const stream = request({
                url: data.download_url,
                method: 'GET',
                qs: {
                    'accessKeyId': this.accessKeyId,
                    'accessKeySecret': this.accessKeySecret
                },
                headers: {
                    'user-agent': 'webdav-server'
                }
            });
            stream.end();
            callback(null, stream);
        });
    }
    _lockManager(path, ctx, callback) {
        debug('EXEC: _lockManager', path.toString());
        callback(null, new webdav_server_1.v2.LocalLockManager());
    }
    _propertyManager(path, ctx, callback) {
        debug('EXEC: _propertyManager', path.toString());
        if (path.isRoot()) {
            let props = this.properties[path.toString()];
            if (!props) {
                props = new webdav_server_1.v2.LocalPropertyManager();
                this.properties[path.toString()] = props;
            }
            return callback(null, props);
        }
        this._parse(path.getParent(), (e, data) => {
            if (e)
                return callback(e);
            let props = this.properties[path.toString()];
            if (!props) {
                props = new webdav_server_1.v2.LocalPropertyManager();
                this.properties[path.toString()] = props;
            }
            const info = data;
            for (const file of info)
                if (file.name === path.fileName()) {
                    const alioss = [];
                    const create = (name, value) => {
                        const el = new XmlBuilder.XMLElementBuilder(name);
                        if (value !== null && value !== undefined)
                            el.add(value);
                        alioss.push(el);
                    };
                    create('json', JSON.stringify(file));
                    create('path', file.path);
                    create('etag', file.etag);
                    create('size', file.size);
                    create('url', file.url);
                    create('download-url', file.download_url);
                    const links = new XmlBuilder.XMLElementBuilder('links');
                    for (const name in file._links)
                        links.ele(name).add(file._links[name]);
                    props.setProperty('alioss', alioss, undefined, (e) => {
                        callback(e, props);
                    });
                    return;
                }
            callback(webdav_server_1.v2.Errors.ResourceNotFound, props);
        });
    }
    _readDir(path, ctx, callback) {
        debug('EXEC: _readDir', path.toString());
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
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
        this._parse(path, (err, resources) => {
            if (err) {
                let url = path.toString(), dir;
                url = url.startsWith('/') ? url.slice(1) : url;
                if (ctx.type.isDirectory) {
                    dir = url + (url.endsWith('/') ? '' : '/');
                    this.client.put(dir, Buffer.alloc(0)).then(rs => (callback(null))).catch(callback);
                }
                else {
                }
                return;
            }
            callback(webdav_server_1.v2.Errors.ResourceAlreadyExists);
        });
    }
    _delete(path, ctx, callback) {
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        debug('Delete Depth:', ctx.depth);
        this._list({ prefix: url, delimiter: '/' }, [], (err, data) => {
            if (err)
                return callback(err);
            if (data.length === 0)
                return callback();
            let dir = url + (url.endsWith('/') ? '' : '/');
            let f = data.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length == 0)
                return callback();
            this.client.deleteMulti(f.map(r => r.path), { quiet: true }).then(res => { debug('Delete Res:', res); callback; }).then(callback);
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
            }
            this.client.copy(to, from).then(res => {
                this._delete(path, { context: ctx.context, depth: 1 }, callback);
            }).catch(callback);
        });
    }
    _move(from, to, ctx, callback) {
        if (from.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        console.log(from, to);
        let fName = from.paths.slice(-1).join(''), tName = to.paths.slice(-1).join('');
        if (fName !== tName && from.paths.slice(0, -1).join('/') === to.paths.slice(1, -1).join('/')) {
            return this._rename(from, tName, { context: ctx.context, destinationPath: to }, callback);
        }
        else {
            this._type(from, { context: ctx.context }, (err, type) => {
                console.log(err, type);
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
                }
                console.log(destPath, srcPath);
                this.client.copy(destPath, srcPath).then(res => {
                    console.log(res);
                    this._delete(from, { context: ctx.context, depth: 1 }, callback);
                }).catch(callback);
            });
        }
    }
    // protected _creationDate(path: webdav.Path, ctx: webdav.CreationDateInfo, callback: webdav.ReturnCallback<number>): void {
    //     this._lastModifiedDate(path, {
    //         context: ctx.context
    //     }, callback);
    // }
    // protected _lastModifiedDate(path: webdav.Path, ctx: webdav.LastModifiedDateInfo, callback: webdav.ReturnCallback<number>): void {
    //     if (path.isRoot())
    //         return callback(null, 0);
    //     this._parse(path, (err, resources) => {
    //         callback(err ? webdav.Errors.ResourceNotFound : null, !resources ? 0 : date.valueOf());
    //     })
    // }
    _size(path, ctx, callback) {
        debug('EXEC: _size', path.toString());
        if (path.isRoot())
            return callback(webdav_server_1.v2.Errors.InvalidOperation);
        this._parse(path, (e, data) => {
            callback(e ? webdav_server_1.v2.Errors.ResourceNotFound : null, data && data.constructor !== Array ? data.size : undefined);
        });
    }
    _type(path, ctx, callback) {
        if (path.isRoot())
            return callback(null, webdav_server_1.v2.ResourceType.Directory);
        this._parse(path, (e, data) => {
            if (e)
                return callback(webdav_server_1.v2.Errors.ResourceNotFound);
            callback(e, data ? data.constructor === Array ? webdav_server_1.v2.ResourceType.Directory : webdav_server_1.v2.ResourceType.File : null);
        });
    }
}
exports.AliOssFileSystem = AliOssFileSystem;
