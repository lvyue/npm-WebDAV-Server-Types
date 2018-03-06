import { AliOssFileSystem } from './AliOssFileSystem';
import { v2 as webdav } from 'webdav-server';
export interface AliOssSerializedData {
    region: string;
    bucket: string;
    properties: {
        [path: string]: webdav.LocalPropertyManager;
    };
    accessKeyId: string;
    accessKeySecret: string;
}
export declare class AliOssSerializer implements webdav.FileSystemSerializer {
    uid(): string;
    serialize(fs: AliOssFileSystem, callback: webdav.ReturnCallback<AliOssSerializedData>): void;
    unserialize(serializedData: AliOssSerializedData, callback: webdav.ReturnCallback<AliOssFileSystem>): void;
}
