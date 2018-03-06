"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var AliOssFileSystem_1 = require("./AliOssFileSystem");
var webdav_server_1 = require("webdav-server");
var AliOssSerializer = /** @class */ (function () {
    function AliOssSerializer() {
    }
    AliOssSerializer.prototype.uid = function () {
        return 'AliOssSerializer-1.0.0';
    };
    AliOssSerializer.prototype.serialize = function (fs, callback) {
        callback(null, {
            properties: fs.properties,
            region: fs.region,
            bucket: fs.bucket,
            accessKeyId: fs.accessKeyId,
            accessKeySecret: fs.accessKeySecret
        });
    };
    AliOssSerializer.prototype.unserialize = function (serializedData, callback) {
        var fs = new AliOssFileSystem_1.AliOssFileSystem(serializedData.region, serializedData.bucket, serializedData.accessKeyId, serializedData.accessKeySecret);
        for (var path in serializedData.properties)
            fs.properties[path] = new webdav_server_1.v2.LocalPropertyManager(serializedData.properties[path]);
        callback(null, fs);
    };
    return AliOssSerializer;
}());
exports.AliOssSerializer = AliOssSerializer;
