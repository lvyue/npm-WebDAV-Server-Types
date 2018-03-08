"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AliOssFileSystem_1 = require("./AliOssFileSystem");
const webdav_server_1 = require("webdav-server");
class AliOssSerializer {
    uid() {
        return 'AliOssSerializer-1.0.0';
    }
    serialize(fs, callback) {
        callback(null, {
            properties: fs.properties,
            region: fs.region,
            bucket: fs.bucket,
            accessKeyId: fs.accessKeyId,
            accessKeySecret: fs.accessKeySecret
        });
    }
    unserialize(serializedData, callback) {
        const fs = new AliOssFileSystem_1.AliOssFileSystem(serializedData.region, serializedData.bucket, serializedData.accessKeyId, serializedData.accessKeySecret);
        for (const path in serializedData.properties)
            fs.properties[path] = new webdav_server_1.v2.LocalPropertyManager(serializedData.properties[path]);
        callback(null, fs);
    }
}
exports.AliOssSerializer = AliOssSerializer;
