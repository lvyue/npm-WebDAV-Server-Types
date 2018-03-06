import { AliOssFileSystem } from './AliOssFileSystem'
import { v2 as webdav } from 'webdav-server'

export interface AliOssSerializedData {
    region: string
    bucket: string
    properties: {
        [path: string]: webdav.LocalPropertyManager
    }
    accessKeyId: string
    accessKeySecret: string
}

export class AliOssSerializer implements webdav.FileSystemSerializer {
    uid(): string {
        return 'AliOssSerializer-1.0.0';
    }

    serialize(fs: AliOssFileSystem, callback: webdav.ReturnCallback<AliOssSerializedData>): void {
        callback(null, {
            properties: fs.properties,
            region: fs.region,
            bucket: fs.bucket,
            accessKeyId: fs.accessKeyId,
            accessKeySecret: fs.accessKeySecret
        });
    }

    unserialize(serializedData: AliOssSerializedData, callback: webdav.ReturnCallback<AliOssFileSystem>): void {
        const fs = new AliOssFileSystem(serializedData.region, serializedData.bucket, serializedData.accessKeyId, serializedData.accessKeySecret);

        for (const path in serializedData.properties)
            fs.properties[path] = new webdav.LocalPropertyManager(serializedData.properties[path]);

        callback(null, fs);
    }
}
