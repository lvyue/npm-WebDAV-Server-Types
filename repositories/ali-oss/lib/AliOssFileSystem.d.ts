/// <reference types="node" />
import { Readable, Writable } from 'stream';
import { v2 as webdav } from 'webdav-server';
import { Wrapper as OSS } from 'ali-oss';
export interface AliOssAPIResource {
    name: string;
    path: string;
    size: number;
    url: string;
    download_url?: string;
    type: webdav.ResourceType;
    last_modified: string;
    etag: string;
    storage_class: string;
    storage_type: string;
    _links: {
        self: string;
    };
}
export interface ALiOssListOptions {
    'prefix'?: string;
    'delimiter'?: string;
    'marker'?: string;
    'max-keys'?: number;
}
export declare class AliOssFileSystem extends webdav.FileSystem {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    properties: {
        [path: string]: webdav.LocalPropertyManager;
    };
    client: OSS;
    cache: {
        [url: string]: {
            error: Error;
            body: any;
            date: number;
        };
    };
    constructor(region: string, bucket: string, accessKeyId: string, accessKeySecret: string);
    protected _get(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource>): void;
    protected _list(options: ALiOssListOptions, data: AliOssAPIResource[], callback: webdav.ReturnCallback<AliOssAPIResource[]>): void;
    protected _parse(path: webdav.Path, callback: webdav.ReturnCallback<AliOssAPIResource[] | AliOssAPIResource>): void;
    protected _openReadStream(path: webdav.Path, ctx: webdav.OpenReadStreamInfo, callback: webdav.ReturnCallback<Readable>): void;
    protected _openWriteStream(path: webdav.Path, ctx: webdav.OpenWriteStreamInfo, callback: webdav.ReturnCallback<Writable>): void;
    protected _lockManager(path: webdav.Path, ctx: webdav.LockManagerInfo, callback: webdav.ReturnCallback<webdav.ILockManager>): void;
    protected _propertyManager(path: webdav.Path, ctx: webdav.PropertyManagerInfo, callback: webdav.ReturnCallback<webdav.IPropertyManager>): void;
    protected _readDir(path: webdav.Path, ctx: webdav.ReadDirInfo, callback: webdav.ReturnCallback<string[] | webdav.Path[]>): void;
    protected _create?(path: webdav.Path, ctx: webdav.CreateInfo, callback: webdav.SimpleCallback): void;
    protected _delete(path: webdav.Path, ctx: webdav.DeleteInfo, callback: webdav.SimpleCallback): void;
    protected _rename(path: webdav.Path, name: string, ctx: webdav.RenameInfo, callback: webdav.ReturnCallback<boolean>): void;
    protected _move(from: webdav.Path, to: webdav.Path, ctx: webdav.MoveInfo, callback: webdav.SimpleCallback): void;
    protected _size(path: webdav.Path, ctx: webdav.SizeInfo, callback: webdav.ReturnCallback<number>): void;
    protected _etag(path: webdav.Path, ctx: webdav.ETagInfo, callback: webdav.ReturnCallback<string>): void;
    protected _creationDate?(path: webdav.Path, ctx: webdav.CreationDateInfo, callback: webdav.ReturnCallback<number>): void;
    protected _lastModifiedDate?(path: webdav.Path, ctx: webdav.LastModifiedDateInfo, callback: webdav.ReturnCallback<number>): void;
    protected _displayName?(path: webdav.Path, ctx: webdav.DisplayNameInfo, callback: webdav.ReturnCallback<string>): void;
    protected _type(path: webdav.Path, ctx: webdav.TypeInfo, callback: webdav.ReturnCallback<webdav.ResourceType>): void;
}
