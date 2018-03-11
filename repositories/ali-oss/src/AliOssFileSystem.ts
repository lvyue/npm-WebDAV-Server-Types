import { AliOssSerializer } from './AliOssSerializer'
import { Readable, Writable, Transform, Duplex } from 'stream'
import { v2 as webdav } from 'webdav-server'
import * as request from 'request'
import { Wrapper as OSS } from 'ali-oss'
import * as DEBUG from 'debug'
import * as XmlBuilder from 'xml-js-builder'
import * as async from 'async'

const debug = DEBUG('oss');

export interface AliOssAPIResource {
    name: string
    path: string
    size: number
    url: string
    download_url?: string
    type: webdav.ResourceType
    last_modified: string,
    etag: string,
    storage_class: string,
    storage_type: string,
    _links: {
        self: string
    }
}
export interface ALiOssListOptions {
    'prefix'?: string
    'delimiter'?: string
    'marker'?: string
    'max-keys'?: number
}

export class AliOssFileSystem extends webdav.FileSystem {
    properties: {
        [path: string]: webdav.LocalPropertyManager
    } = {};
    client: OSS
    cache: {
        [url: string]: {
            error: Error,
            body: any
            date: number
        }
    } = {};

    constructor(public region: string, public bucket: string, public accessKeyId: string, public accessKeySecret: string) {
        super(new AliOssSerializer());
        this.client = new OSS({ region, bucket, accessKeyId, accessKeySecret });
    }

    protected _get(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource>): void {
        let url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        this._list({
            prefix: url,
            delimiter: '/'
        }, [], (err, resources) => {
            if (err)
                return callback(webdav.Errors.ResourceNotFound);
            let dir = url + (url.endsWith('/') ? '' : '/')
            let f = resources.filter(r => (r.path === url || r.path === dir));
            if (f.length === 1) { // 只有一个
                return callback(null, f[0]);
            } else {
                callback(webdav.Errors.ResourceNotFound);
            }
        });
    }


    protected _list(options: ALiOssListOptions, data: AliOssAPIResource[], callback: webdav.ReturnCallback<AliOssAPIResource[]>): void {
        this.client.list(options).then(res => {
            let e;
            if (res.statusCode === 404)
                e = webdav.Errors.ResourceNotFound;
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
                    type: obj.name.endsWith('/') ? webdav.ResourceType.Directory : webdav.ResourceType.File,
                    _links: {
                        self: obj.url
                    }
                } as AliOssAPIResource)) : [],
                (res.prefixes && res.prefixes.length > 0) ?
                    res.prefixes.map(obj => ({
                        name: obj.split('/').splice(-2).join(''),
                        path: obj,
                        size: 0,
                        type: webdav.ResourceType.Directory,
                    } as AliOssAPIResource)) : []);
            if (res.nextMarker) { // 继续搜索
                options.marker = res.nextMarker;
                this._list(options, data, callback);
            } else {
                callback(e, data);
            }
        }).catch(e => {
            callback(e);
        });
    }

    protected _parse(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource[] | AliOssAPIResource>) {
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
                return callback(webdav.Errors.ResourceNotFound);
            let dir = url + (url.endsWith('/') ? '' : '/')
            let f = resources.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length === 1) {
                if (f[0].type.isFile) {
                    return callback(null, f[0])
                } else {
                    return this._list({ 'prefix': f[0].path, delimiter: '/', marker: f[0].path }, [], callback)
                }
            } else if (f.length > 1) {
                return callback(null, f);
            } else {
                callback(webdav.Errors.ResourceNotFound);
            }
        })

    }

    protected _openReadStream(path: webdav.Path, ctx: webdav.OpenReadStreamInfo, callback: webdav.ReturnCallback<Readable>): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        let oKey = path.toString();
        oKey = oKey.startsWith('/') ? oKey.slice(1) : oKey;
        this.client.getStream(oKey).then(res => { callback(null, res.stream) }).catch(callback)
    }

    protected _openWriteStream(path: webdav.Path, ctx: webdav.OpenWriteStreamInfo, callback: webdav.ReturnCallback<Writable>): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        const wStream = new Transform({
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

    protected _lockManager(path: webdav.Path, ctx: webdav.LockManagerInfo, callback: webdav.ReturnCallback<webdav.ILockManager>): void {
        debug('EXEC: _lockManager', path.toString())
        callback(null, new webdav.LocalLockManager());
    }

    protected _propertyManager(path: webdav.Path, ctx: webdav.PropertyManagerInfo, callback: webdav.ReturnCallback<webdav.IPropertyManager>): void {
        debug('EXEC: _propertyManager', path.toString())
        this._get(path, (err, data) => {
            if (err || !data)
                return callback(webdav.Errors.ResourceNotFound);
            let props = new webdav.LocalPropertyManager();
            for (let prop in data) {
                props[prop] = data[prop];
            }
            return callback(null, props);
        })
    }

    protected _readDir(path: webdav.Path, ctx: webdav.ReadDirInfo, callback: webdav.ReturnCallback<string[] | webdav.Path[]>): void {
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
                return callback(webdav.Errors.ResourceNotFound);
            callback(null, resources.map(r => r.path))
        });
    }

    protected _create?(path: webdav.Path, ctx: webdav.CreateInfo, callback: webdav.SimpleCallback): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        if (ctx.type.isDirectory) { // dir
            dir = url + (url.endsWith('/') ? '' : '/');
            this.client.put(dir, Buffer.alloc(0)).then(rs => (callback())).catch(callback);
        } else { // file 
            debug('Create:', path)
            callback();
        }
    }

    protected _delete(path: webdav.Path, ctx: webdav.DeleteInfo, callback: webdav.SimpleCallback): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        this._list({ prefix: url }, [], (err, data) => {
            if (err)
                return callback(err);
            if (data.length === 0)
                return callback();
            let dir = url + (url.endsWith('/') ? '' : '/')
            let f = data.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length == 0)
                return callback();
            this.client.deleteMulti(f.map(r => r.path), { quiet: true }).then(res => { callback() }).then(callback);
        });
    }

    protected _rename(path: webdav.Path, name: string, ctx: webdav.RenameInfo, callback: webdav.ReturnCallback<boolean>): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        this._type(path, { context: ctx.context }, (err, type) => {
            if (err)
                return callback(err);
            if (!type)
                return callback(webdav.Errors.ResourceNotFound)
            let from = path.toString(),
                to = path.paths.slice(0, -1).join('/')
            from = from.startsWith('/') ? from.slice(1) : from;
            to = to + (to.endsWith('/') ? '' : '/') + name;
            if (type.isDirectory) {
                from += from.endsWith('/') ? '' : '/'
                to += to.endsWith('/') ? '' : '/'
                this._list({ prefix: from }, [], (err, objs) => {
                    if (err)
                        return callback(err);
                    let actions = objs.map(o => ({ from: o.path, to: to + o.path.slice(from.length) }));
                    async.eachLimit(actions, 10, (action, done) => {
                        this.client.copy(action.to, action.from).then(() => { done() }).catch(done);
                    }, err => {
                        if (err)
                            return callback(err);
                        this.client.deleteMulti(actions.map(a => a.from), { quiet: true }).then(() => { callback() }).catch(e => {
                            callback(e)
                        });
                    })
                })
            } else { // 文件复制
                this.client.copy(to, from).then(res => {
                    this._delete(path, { context: ctx.context, depth: -1 }, callback)
                }).catch(callback)
            }

        })
    }


    protected _move(from: webdav.Path, to: webdav.Path, ctx: webdav.MoveInfo, callback: webdav.SimpleCallback): void {
        if (from.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        let fName = from.paths.slice(-1).join(''), tName = to.paths.slice(-1).join('');
        if (fName !== tName && from.paths.slice(0, -1).join('/') === to.paths.slice(1, -1).join('/')) { // 重命名
            return this._rename(from, tName, { context: ctx.context, destinationPath: to }, callback);
        } else { // 移动
            this._type(from, { context: ctx.context }, (err, type) => {
                if (err)
                    return callback(err);
                if (!type)
                    return callback(webdav.Errors.ResourceNotFound)
                let srcPath = from.toString(),
                    destPath = to.paths.slice(1).join('/')
                srcPath = srcPath.startsWith('/') ? srcPath.slice(1) : srcPath;
                destPath = destPath.startsWith('/') ? destPath.slice(1) : destPath;
                if (type.isDirectory) {
                    srcPath += srcPath.endsWith('/') ? '' : '/'
                    destPath += destPath.endsWith('/') ? '' : '/'
                    this._list({ prefix: srcPath }, [], (err, objs) => {
                        if (err)
                            return callback(err);
                        let actions = objs.map(o => ({ from: o.path, to: destPath + o.path.slice(srcPath.length) }));
                        async.eachLimit(actions, 10, (action, done) => {
                            this.client.copy(action.to, action.from).then(() => { done() }).catch(done);
                        }, err => {
                            if (err)
                                return callback(err);
                            this.client.deleteMulti(actions.map(a => a.from), { quiet: true }).then(() => { callback() }).catch(e => {
                                callback(e)
                            });
                        })
                    })
                } else {
                    console.log(destPath, srcPath);
                    this.client.copy(destPath, srcPath).then(res => {
                        console.log(res)
                        this._delete(from, { context: ctx.context, depth: 1 }, callback)
                    }).catch(callback)
                }
            });
        }
    }

    protected _size(path: webdav.Path, ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void {
        if (path.isRoot())
            return callback(null, undefined);
        this._get(path, (err, resource) => {
            if (err || !resource) // 未找到
                return callback(err || webdav.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? undefined : resource.size);
        })
    }

    protected _etag(path: webdav.Path, ctx: webdav.ETagInfo, callback: webdav.ReturnCallback<string>): void {
        if (path.isRoot())
            return callback(null, undefined);
        this._get(path, (err, resource) => {
            if (err || !resource) // 未找到
                return callback(err || webdav.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? undefined : resource.etag);
        })
    }

    protected _creationDate?(path: webdav.Path, ctx: webdav.CreationDateInfo, callback: webdav.ReturnCallback<number>): void {
        if (path.isRoot())
            return callback(null, Date.now());
        this._get(path, (err, resource) => {
            if (err || !resource) // 未找到
                return callback(err || webdav.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? Date.now() : new Date(resource.last_modified).getTime());
        });
    }

    protected _lastModifiedDate?(path: webdav.Path, ctx: webdav.LastModifiedDateInfo, callback: webdav.ReturnCallback<number>): void {
        if (path.isRoot())
            return callback(null, Date.now());
        this._get(path, (err, resource) => {
            if (err || !resource) // 未找到
                return callback(err || webdav.Errors.ResourceNotFound);
            return callback(err, resource.type.isDirectory ? Date.now() : new Date(resource.last_modified).getTime());
        });
    }

    protected _displayName?(path: webdav.Path, ctx: webdav.DisplayNameInfo, callback: webdav.ReturnCallback<string>): void {
        if (path.isRoot())
            return callback(null, '/');
        this._get(path, (err, resource) => {
            if (err || !resource) // 未找到
                return callback(err || webdav.Errors.ResourceNotFound);
            return callback(null, resource.name);
        })
    }

    protected _type(path: webdav.Path, ctx: webdav.TypeInfo, callback: webdav.ReturnCallback<webdav.ResourceType>): void {
        if (path.isRoot())
            return callback(null, webdav.ResourceType.Directory);
        this._get(path, (e, data) => {
            if (e)
                return callback(webdav.Errors.ResourceNotFound);
            callback(e, data ? data.type : null);
        })
    }
}
