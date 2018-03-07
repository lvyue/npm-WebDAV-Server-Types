"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var AliOssSerializer_1 = require("./AliOssSerializer");
var webdav_server_1 = require("webdav-server");
var request = require("request");
var ali_oss_1 = require("ali-oss");
var DEBUG = require("debug");
var xml_js_builder_1 = require("xml-js-builder");
var debug = DEBUG('ali-oss');
var AliOssFileSystem = /** @class */ (function (_super) {
    __extends(AliOssFileSystem, _super);
    function AliOssFileSystem(region, bucket, accessKeyId, accessKeySecret) {
        var _this = _super.call(this, new AliOssSerializer_1.AliOssSerializer()) || this;
        _this.region = region;
        _this.bucket = bucket;
        _this.accessKeyId = accessKeyId;
        _this.accessKeySecret = accessKeySecret;
        _this.properties = {};
        _this.cache = {};
        _this.base = 'https://api.github.com/repos/' + region + '/' + bucket + '/contents';
        if (_this.base.lastIndexOf('/') === _this.base.length - 1)
            _this.base = _this.base.substring(0, _this.base.length - 1);
        _this.client = new ali_oss_1.Wrapper({ region: region, bucket: bucket, accessKeyId: accessKeyId, accessKeySecret: accessKeySecret });
        return _this;
    }
    AliOssFileSystem.prototype._parse = function (path, callback) {
        var _this = this;
        debug('EXEC: _parse', path.toString());
        debug('EXEC:isROOT ?', path.isRoot());
        var url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        var cached = this.cache[url];
        if (cached && cached.date + 5000 < Date.now())
            return callback(cached.error, cached.body);
        this.client.list({
            "prefix": url,
            "delimiter": "/"
        }).then(function (res) {
            var e, body = [];
            debug('RES:', res);
            if (res.statusCode === 404)
                e = webdav_server_1.v2.Errors.ResourceNotFound;
            if (res.objects && res.objects.length > 0)
                body.concat(res.objects.map(function (obj) { return ({
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
                }); }));
            if (res.prefixes && res.prefixes.length > 0) {
                body.concat(res.prefixes.map(function (obj) { return ({
                    name: obj.split('/').splice(-2).join(''),
                    path: obj,
                    size: 0,
                    type: 'dir',
                }); }));
            }
            _this.cache[url] = {
                body: body,
                error: e,
                date: Date.now()
            };
            callback(e, body);
        }).catch(function (e) {
            debug('ERROR:', e);
            _this.cache[url] = {
                body: null,
                error: e,
                date: Date.now()
            };
            callback(e);
        });
    };
    AliOssFileSystem.prototype._openReadStream = function (path, ctx, callback) {
        var _this = this;
        debug('EXEC: _openReadStream', path.toString());
        this._parse(path, function (e, data) {
            if (e)
                return callback(e);
            if (data.constructor === Array)
                return callback(webdav_server_1.v2.Errors.InvalidOperation);
            var stream = request({
                url: data.download_url,
                method: 'GET',
                qs: {
                    'accessKeyId': _this.accessKeyId,
                    'accessKeySecret': _this.accessKeySecret
                },
                headers: {
                    'user-agent': 'webdav-server'
                }
            });
            stream.end();
            callback(null, stream);
        });
    };
    AliOssFileSystem.prototype._lockManager = function (path, ctx, callback) {
        debug('EXEC: _lockManager', path.toString());
        callback(null, new webdav_server_1.v2.LocalLockManager());
    };
    AliOssFileSystem.prototype._propertyManager = function (path, ctx, callback) {
        var _this = this;
        debug('EXEC: _propertyManager', path.toString());
        if (path.isRoot()) {
            var props = this.properties[path.toString()];
            if (!props) {
                props = new webdav_server_1.v2.LocalPropertyManager();
                this.properties[path.toString()] = props;
            }
            return callback(null, props);
        }
        this._parse(path.getParent(), function (e, data) {
            if (e)
                return callback(e);
            var props = _this.properties[path.toString()];
            if (!props) {
                props = new webdav_server_1.v2.LocalPropertyManager();
                _this.properties[path.toString()] = props;
            }
            var info = data;
            var _loop_1 = function (file) {
                if (file.name === path.fileName()) {
                    var github_1 = [];
                    var create = function (name, value) {
                        var el = xml_js_builder_1.XMLElementBuilder.createElement(name);
                        if (value !== null && value !== undefined)
                            el.add(value);
                        github_1.push(el);
                    };
                    create('json', JSON.stringify(file));
                    create('path', file.path);
                    create('etag', file.etag);
                    create('size', file.size);
                    create('url', file.url);
                    create('download-url', file.download_url);
                    create('type', file.type);
                    var links = xml_js_builder_1.XMLElementBuilder.createElement('links');
                    for (var name_1 in file._links)
                        links.ele(name_1).add(file._links[name_1]);
                    props.setProperty('github', github_1, undefined, function (e) {
                        callback(e, props);
                    });
                    return { value: void 0 };
                }
            };
            for (var _i = 0, info_1 = info; _i < info_1.length; _i++) {
                var file = info_1[_i];
                var state_1 = _loop_1(file);
                if (typeof state_1 === "object")
                    return state_1.value;
            }
            callback(webdav_server_1.v2.Errors.ResourceNotFound, props);
        });
    };
    AliOssFileSystem.prototype._readDir = function (path, ctx, callback) {
        debug('EXEC: _readDir', path.toString());
        var url = path.toString();
        url = url.startsWith('/') ? url.slice(1) : url;
        this.client.list({
            prefix: url,
            delimiter: '/'
        }).then(function (res) {
            var e, body = [];
            if (res.statusCode === 404)
                e = webdav_server_1.v2.Errors.ResourceNotFound;
            if (res.objects && res.objects.length > 0)
                body.concat(res.objects.map(function (obj) { return obj.name; }));
            if (res.prefixes && res.prefixes.length > 0) {
                body.concat(res.prefixes);
            }
            debug('READ DIR:', body);
            callback(e, body);
        }).catch(callback);
    };
    AliOssFileSystem.prototype._size = function (path, ctx, callback) {
        debug('EXEC: _size', path.toString());
        this._parse(path, function (e, data) {
            callback(e, data && data.constructor !== Array ? data.size : undefined);
        });
    };
    AliOssFileSystem.prototype._type = function (path, ctx, callback) {
        debug('EXEC: _size', path.toString());
        if (path.isRoot())
            return callback(null, webdav_server_1.v2.ResourceType.Directory);
        this._parse(path, function (e, data) {
            callback(e, data ? data.constructor === Array ? webdav_server_1.v2.ResourceType.Directory : webdav_server_1.v2.ResourceType.File : null);
        });
    };
    return AliOssFileSystem;
}(webdav_server_1.v2.FileSystem));
exports.AliOssFileSystem = AliOssFileSystem;
