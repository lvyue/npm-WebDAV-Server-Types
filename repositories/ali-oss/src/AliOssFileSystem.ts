import { AliOssSerializer } from './AliOssSerializer'
import { Readable, Writable } from 'stream'
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


    protected _list(options: ALiOssListOptions, data: AliOssAPIResource[], callback: webdav.ReturnCallback<AliOssAPIResource[]>) {
        this.client.list(options).then(res => {
            let e;
            debug('_list:', res)
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
            debug('Data:', data)
            if (res.nextMarker) { // 继续搜索
                options.marker = res.nextMarker;
                this._list(options, data, callback);
            } else {
                callback(e, data);
            }
        }).catch(e => {
            debug('ERROR:', e)
            callback(e);
        });
    }

    protected _parse(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource[] | AliOssAPIResource>) {
        debug('EXEC: _parse', path);
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

    protected _openReadStream?(path: webdav.Path, ctx: webdav.OpenReadStreamInfo, callback: webdav.ReturnCallback<Readable>): void {
        debug('EXEC: _openReadStream', path.toString())
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        this._parse(path, (e, data) => {
            if (e)
                return callback(e);

            if (data.constructor === Array)
                return callback(webdav.Errors.InvalidOperation);

            const stream = request({
                url: (data as AliOssAPIResource).download_url,
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
            callback(null, (stream as any) as Readable);
        })
    }

    protected _lockManager(path: webdav.Path, ctx: webdav.LockManagerInfo, callback: webdav.ReturnCallback<webdav.ILockManager>): void {
        debug('EXEC: _lockManager', path.toString())

        callback(null, new webdav.LocalLockManager());
    }

    protected _propertyManager(path: webdav.Path, ctx: webdav.PropertyManagerInfo, callback: webdav.ReturnCallback<webdav.IPropertyManager>): void {
        debug('EXEC: _propertyManager', path.toString())

        if (path.isRoot()) {
            let props = this.properties[path.toString()];
            if (!props) {
                props = new webdav.LocalPropertyManager();
                this.properties[path.toString()] = props;
            }

            return callback(null, props);
        }

        this._parse(path.getParent(), (e, data) => {
            if (e)
                return callback(e);

            let props = this.properties[path.toString()];
            if (!props) {
                props = new webdav.LocalPropertyManager();
                this.properties[path.toString()] = props;
            }

            const info = data as AliOssAPIResource[];
            for (const file of info)
                if (file.name === path.fileName()) {
                    const alioss = [];
                    const create = (name: string, value: string | number) => {
                        const el = new XmlBuilder.XMLElementBuilder(name);
                        if (value !== null && value !== undefined)
                            el.add(value);
                        alioss.push(el);
                    }
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

            callback(webdav.Errors.ResourceNotFound, props);
        })
    }

    protected _readDir(path: webdav.Path, ctx: webdav.ReadDirInfo, callback: webdav.ReturnCallback<string[] | webdav.Path[]>): void {
        debug('EXEC: _readDir', path.toString())
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
        this._parse(path, (err, resources) => {
            if (err) {
                let url = path.toString(), dir;
                url = url.startsWith('/') ? url.slice(1) : url;
                if (ctx.type.isDirectory) { // dir
                    dir = url + (url.endsWith('/') ? '' : '/');
                    this.client.put(dir, Buffer.alloc(0)).then(rs => (callback(null))).catch(callback);
                } else { // file 

                }
                return;
            }
            callback(webdav.Errors.ResourceAlreadyExists)
        });

    }

    protected _delete(path: webdav.Path, ctx: webdav.DeleteInfo, callback: webdav.SimpleCallback): void {
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        let url = path.toString(), dir;
        url = url.startsWith('/') ? url.slice(1) : url;
        debug('Delete Depth:', ctx.depth);
        this._list({ prefix: url }, [], (err, data) => {
            if (err)
                return callback(err);
            if (data.length === 0)
                return callback();
            let dir = url + (url.endsWith('/') ? '' : '/')
            let f = data.filter(r => (r.path === url || r.path.startsWith(dir)));
            if (f.length == 0)
                return callback();
            this.client.deleteMulti(f.map(r => r.path), { quiet: true }).then(res => { debug('Delete Res:', res); callback }).then(callback);
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
                    debug('Actions:', actions);
                    async.eachLimit(actions, 10, (action, done) => {
                        this.client.copy(action.to, action.from).then(done).catch(done);
                    }, err => {
                        if (err)
                            return callback(err);
                        this.client.deleteMulti(actions.map(a => a.from), { quiet: true }).then(callback).catch(callback);
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
        console.log(from, to);
        let fName = from.paths.slice(-1).join(''), tName = to.paths.slice(-1).join('');
        if (fName !== tName && from.paths.slice(0, -1).join('/') === to.paths.slice(1, -1).join('/')) { // 重命名
            return this._rename(from, tName, { context: ctx.context, destinationPath: to }, callback);
        } else { // 移动
            this._type(from, { context: ctx.context }, (err, type) => {
                console.log(err, type)
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
                }
                console.log(destPath, srcPath);
                this.client.copy(destPath, srcPath).then(res => {
                    console.log(res)
                    this._delete(from, { context: ctx.context, depth: 1 }, callback)
                }).catch(callback)
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

    protected _size(path: webdav.Path, ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void {
        debug('EXEC: _size', path.toString())
        if (path.isRoot())
            return callback(webdav.Errors.InvalidOperation);
        this._parse(path, (e, data) => {
            callback(e ? webdav.Errors.ResourceNotFound : null, data && data.constructor !== Array ? (data as AliOssAPIResource).size : undefined);
        })
    }

    protected _type(path: webdav.Path, ctx: webdav.TypeInfo, callback: webdav.ReturnCallback<webdav.ResourceType>): void {
        if (path.isRoot())
            return callback(null, webdav.ResourceType.Directory);
        this._parse(path, (e, data) => {
            if (e)
                return callback(webdav.Errors.ResourceNotFound);
            callback(e, data ? data.constructor === Array ? webdav.ResourceType.Directory : webdav.ResourceType.File : null);
        })
    }
}
