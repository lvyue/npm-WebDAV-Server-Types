import { AliOssSerializer } from './AliOssSerializer'
import { Readable, Writable } from 'stream'
import { v2 as webdav } from 'webdav-server'
import * as request from 'request'
import { Wrapper as OSS } from 'ali-oss'

export interface AliOssAPIResource {
    name: string
    path: string
    sha: string
    size: number
    url: string
    html_url: string
    git_url: string
    download_url: string
    type: 'file' | 'dir'
    _links: {
        self: string
        git: string
        html: string
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

    protected _parse(subPath: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource[] | AliOssAPIResource>) {
        const url = subPath.toString();
        const cached = this.cache[url];
        if (cached && cached.date + 5000 < Date.now())
            return callback(cached.error, cached.body);

        request({
            url,
            method: 'GET',
            qs: {
                'accessKeyId': this.accessKeyId,
                'accessKeySecret': this.accessKeySecret
            },
            headers: {
                'user-agent': 'webdav-server'
            }
        }, (e, res, body) => {
            if (res.statusCode === 404)
                e = webdav.Errors.ResourceNotFound;
            if (body)
                body = JSON.parse(body);
            if (!e && body.message)
                e = new Error(body.message);

            this.cache[url] = {
                body,
                error: e,
                date: Date.now()
            }

            callback(e, body);
        })
    }

    protected _openReadStream?(path: webdav.Path, ctx: webdav.OpenReadStreamInfo, callback: webdav.ReturnCallback<Readable>): void {
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
        callback(null, new webdav.LocalLockManager());
    }

    protected _propertyManager(path: webdav.Path, ctx: webdav.PropertyManagerInfo, callback: webdav.ReturnCallback<webdav.IPropertyManager>): void {
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
                        const el = webdav.XML.createElement(name);
                        if (value !== null && value !== undefined)
                            el.add(value);
                        github.push(el);
                    }
                    create('json', JSON.stringify(file));
                    create('path', file.path);
                    create('sha', file.sha);
                    create('size', file.size);
                    create('url', file.url);
                    create('html-url', file.html_url);
                    create('git-url', file.git_url);
                    create('download-url', file.download_url);
                    create('type', file.type);
                    const links = webdav.XML.createElement('links');
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
        this._parse(path, (e, data) => {
            if (e)
                return callback(e);

            if (data.constructor !== Array)
                return callback(webdav.Errors.InvalidOperation);

            callback(null, (data as AliOssAPIResource[]).map((r) => r.name));
        })
    }

    protected _size(path: webdav.Path, ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void {
        this._parse(path, (e, data) => {
            callback(e, data && data.constructor !== Array ? (data as AliOssAPIResource).size : undefined);
        })
    }

    protected _type(path: webdav.Path, ctx: webdav.TypeInfo, callback: webdav.ReturnCallback<webdav.ResourceType>): void {
        if (path.isRoot())
            return callback(null, webdav.ResourceType.Directory);

        this._parse(path, (e, data) => {
            callback(e, data ? data.constructor === Array ? webdav.ResourceType.Directory : webdav.ResourceType.File : null);
        })
    }
}
