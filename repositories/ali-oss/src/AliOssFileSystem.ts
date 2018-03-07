import { AliOssSerializer } from './AliOssSerializer'
import { Readable, Writable } from 'stream'
import { v2 as webdav } from 'webdav-server'
import * as request from 'request'
import { Wrapper as OSS } from 'ali-oss'
import * as DEBUG from 'debug'
import { XMLElementBuilder as XEB } from 'xml-js-builder'
const debug = DEBUG('ali-oss');

export interface AliOssAPIResource {
    name: string
    path: string
    size: number
    url: string
    download_url?: string
    type: 'file' | 'dir'
    last_modified: string,
    etag: string,
    storage_class: string,
    storage_type: string,
    _links: {
        self: string
    }
}

export class AliOssFileSystem extends webdav.FileSystem {
    properties: {
        [path: string]: webdav.LocalPropertyManager
    } = {};
    base: string
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

        this.base = 'https://api.github.com/repos/' + region + '/' + bucket + '/contents';
        if (this.base.lastIndexOf('/') === this.base.length - 1)
            this.base = this.base.substring(0, this.base.length - 1);
        this.client = new OSS({ region, bucket, accessKeyId, accessKeySecret });
    }

    protected _parse(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource[] | AliOssAPIResource>) {
        debug('EXEC: _parse', path.toString())
        debug('EXEC:isROOT ?', path.isRoot())
        let url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        const cached = this.cache[url];
        if (cached && cached.date + 5000 < Date.now())
            return callback(cached.error, cached.body);
        this.client.list({
            "prefix": url,
            "delimiter": "/"
        }).then(res => {
            let e, body = [];
            debug('RES:', res)
            if (res.statusCode === 404)
                e = webdav.Errors.ResourceNotFound;
            if (res.objects && res.objects.length > 0)
                body.concat(res.objects.map(obj => ({
                    name: obj.name.split('/').splice(-2).join(''),
                    path: obj.name,
                    size: obj.size,
                    url: obj.url,
                    etag: obj.etag,
                    last_modified: obj.lastModified,
                    storage_class: obj.storageClass,
                    storage_type: obj.type,
                    type: obj.name.endsWith('/') ? 'dir' : 'file',
                    _links: {
                        self: obj.url
                    }
                } as AliOssAPIResource)));
            if (res.prefixes && res.prefixes.length > 0) {
                body.concat(res.prefixes.map(obj => ({
                    name: obj.split('/').splice(-2).join(''),
                    path: obj,
                    size: 0,
                    type: 'dir',
                } as AliOssAPIResource)));
            }
            this.cache[url] = {
                body,
                error: e,
                date: Date.now()
            }
            callback(e, body);
        }).catch(e => {
            debug('ERROR:', e)
            this.cache[url] = {
                body: null,
                error: e,
                date: Date.now()
            }
            callback(e);
        });
    }

    protected _openReadStream?(path: webdav.Path, ctx: webdav.OpenReadStreamInfo, callback: webdav.ReturnCallback<Readable>): void {
        debug('EXEC: _openReadStream', path.toString())
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
                    const github = [];
                    const create = (name: string, value: string | number) => {
                        const el = XEB.createElement(name);
                        if (value !== null && value !== undefined)
                            el.add(value);
                        github.push(el);
                    }
                    create('json', JSON.stringify(file));
                    create('path', file.path);
                    create('etag', file.etag);
                    create('size', file.size);
                    create('url', file.url);
                    create('download-url', file.download_url);
                    create('type', file.type);
                    const links = XEB.createElement('links');
                    for (const name in file._links)
                        links.ele(name).add(file._links[name]);

                    props.setProperty('github', github, undefined, (e) => {
                        callback(e, props);
                    });
                    return;
                }

            callback(webdav.Errors.ResourceNotFound, props);
        })
    }

    protected _readDir(path: webdav.Path, ctx: webdav.ReadDirInfo, callback: webdav.ReturnCallback<string[] | webdav.Path[]>): void {
        debug('EXEC: _readDir', path.toString())
        let url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        this.client.list({
            prefix: url,
            delimiter: '/'
        }).then(res => {
            let e, body = [];
            if (res.statusCode === 404)
                e = webdav.Errors.ResourceNotFound;
            if (res.objects && res.objects.length > 0)
                body.concat(res.objects.map(obj => obj.name));
            if (res.prefixes && res.prefixes.length > 0) {
                body.concat(res.prefixes);
            }
            debug('READ DIR:', body)
            callback(e, body);
        }).catch(callback);
    }

    protected _size(path: webdav.Path, ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void {
        debug('EXEC: _size', path.toString())
        this._parse(path, (e, data) => {
            callback(e, data && data.constructor !== Array ? (data as AliOssAPIResource).size : undefined);
        })
    }

    protected _type(path: webdav.Path, ctx: webdav.TypeInfo, callback: webdav.ReturnCallback<webdav.ResourceType>): void {
        debug('EXEC: _size', path.toString())
        if (path.isRoot())
            return callback(null, webdav.ResourceType.Directory);

        this._parse(path, (e, data) => {
            callback(e, data ? data.constructor === Array ? webdav.ResourceType.Directory : webdav.ResourceType.File : null);
        })
    }
}
