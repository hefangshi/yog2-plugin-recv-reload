var path = require('path');
var yog = require('yog2-kernel');
var debuglog = require('debuglog')('yog/recv-reload');

module.exports['recv-reload'] = ['dispatcher',
    function (app, conf) {
        // only enable when YOG_DEBUG=true
        if (yog.DEBUG) {
            var cluster = require('cluster');
            var multiparty = require('multiparty');
            var fs = require('fs-extra');

            setTimeout(function () {
                if (cluster.isWorker) {
                    console.log('[WARN] recv-reload plugin is better to run without cluster');
                }
                console.log('[NOTICE] recv-reload plugin is running in ' + conf.receiverUrl +
                    ', please disable it in production');
            }, 1000);


            app.get(conf.cleanCacheUrl + '/:app', function (req, res) {
                reloadApp(req.params.app);
                reloadView();
                res.end('cache cleaned');
                conf.onCacheClean && conf.onCacheClean(req.params.app);
            });

            app.get(conf.cleanCacheUrl, function (req, res) {
                reloadApp();
                reloadView();
                res.end('cache cleaned');
                conf.onCacheClean && conf.onCacheClean();
            });

            app.post(conf.receiverUrl, function (req, res, next) {
                if (uploadError) {
                    return next(new Error('fs error'));
                }
                var goNext = function (err) {
                    uploading--;
                    return next(err);
                };
                uploading++;
                total++;
                startUploadStateCheck(conf.uploadTimeout, function () {
                    // reload uploaded app
                    var apps = Object.keys(waitingReloadApps);
                    if (apps.length === 0) {
                        reloadView();
                    } else {
                        for (var i = 0; i < apps.length; i++) {
                            reloadApp(apps[i]);
                        }
                        reloadView();
                    }
                    conf.onCacheClean && conf.onCacheClean();
                    waitingReloadApps = {};
                    uploadError = false;
                });
                // parse a file upload 
                var form = new multiparty.Form();
                form.parse(req, function (err, fields, files) {
                    if (err) return goNext(err);
                    if (!files.file || !files.file[0]) return goNext(new Error('invalid upload file'));
                    res.end('0');
                    // record uploading app
                    if (fields.to) {
                        var paths = fields.to.toString().split(path.sep);
                        var appRootPath = yog.conf.dispatcher.appPath || path.join(yog.ROOT_PATH, 'app');
                        var deployPath = path.join(yog.ROOT_PATH, fields.to.toString());
                        var appPath = path.relative(appRootPath, deployPath);
                        if (appPath.indexOf('..') !== 0) {
                            var appName = appPath.split(path.sep)[0];
                            if (appName) {
                                waitingReloadApps[appName] = true;
                            }
                        }
                    }
                    fs.move(
                        files.file[0].path, yog.ROOT_PATH + fields.to, {
                            clobber: true
                        },
                        function (err) {
                            if (err) {
                                uploadError = true;
                            }
                            uploading--;
                        }
                    );
                });
            });

            app.get(conf.receiverUrl, function (req, res) {
                res.end(req.protocol + '://' + req.get('host') + conf.receiverUrl + ' is ready to work');
            });

            yog.reloadApp = reloadApp;
            yog.reloadView = reloadView;
        }
    }
];

module.exports['recv-reload'].defaultConf = {
    cleanCacheUrl: '/yog/reload',
    receiverUrl: '/yog/upload',
    uploadTimeout: 30,
    onCacheClean: null
};


/**
 * 上传监测到的app
 * @type {Object}
 */
var waitingReloadApps = {};

/**
 * 上传过程中是否有出现异常
 * @type {Boolean}
 */
var uploadError = false;

/**
 * 全局检测状态
 * @type {Boolean}
 */
var globalCheckSatus = false;
/**
 * 当前上传作业数量
 * @type {Number}
 */
var uploading = 0;
/**
 * 总上传作业数量
 * @type {Number}
 */
var total = 0;

/**
 * 检测上传是否结束
 * @param  {[type]}   timeout [description]
 * @param  {Function} cb      [description]
 * @return {[type]}           [description]
 */
function startUploadStateCheck(timeout, cb) {
    var checkTimer = null;

    /**
     * 每10ms检测一次uploading状态，当前没有上传任务时，uploading为0
     * @return {[type]} [description]
     */
    function checkUplodingStatus() {
        checkTimer = setInterval(function () {
            if (uploading === 0 && checkTimer) {
                clearInterval(checkTimer);
                checkTimer = null;
                // 检测通过，开始检测50ms内是否还有新请求
                waitforNewUpload();
            }
        }, 10);
    }

    /**
     * 判断20ms内是否还有新增的上传请求，如果有则回到uploding检测状态
     * @return {[type]} [description]
     */
    function waitforNewUpload() {
        var periodTotal = total;
        setTimeout(function () {
            if (periodTotal === total) {
                debuglog('detect upload end');
                end();
            } else {
                debuglog('restart upload detect', periodTotal, total);
                checkUplodingStatus(cb);
            }
        }, 50);
    }

    function end() {
        globalCheckSatus = false;
        clearTimeout(uploadTimeout);
        uploadTimeout = null;
        clearInterval(checkTimer);
        checkTimer = null;
        total = 0;
        cb && cb();
    }

    if (globalCheckSatus) {
        return;
    }

    globalCheckSatus = true;

    checkUplodingStatus();

    // 上传整体超时检测
    var uploadTimeout = setTimeout(function () {
        debuglog('upload timeout');
        end();
    }, timeout * 1000);
}


function reloadApp(appName) {
    debuglog('reload app', appName);
    appName = appName || '';
    var appPath = yog.conf.dispatcher.appPath || path.join(yog.ROOT_PATH, 'app');
    var appModulePath = path.join(appPath, appName);
    cleanCacheForFolder(appModulePath);
    if (yog.dispatcher && yog.dispatcher.cleanCache) {
        yog.dispatcher.cleanCache();
        debuglog('clean dispatcher cache');
    }
}

function reloadView() {
    if (yog.view && yog.view.cleanCache) {
        yog.view.cleanCache();
        debuglog('clean view cache');
    }
}

function cleanCacheForFolder(moduleFolderPath) {
    moduleFolderPath = moduleFolderPath.toLowerCase() + path.sep;
    var modules = Object.keys(require.cache);
    for (var i = 0; i < modules.length; i++) {
        var modulePath = modules[i];
        if (modulePath.toLowerCase().indexOf(moduleFolderPath) === 0) {
            cleanCache(modulePath);
            debuglog('clean cache: ', path.relative(yog.ROOT_PATH, modulePath));
        }
    }
}

function cleanCache(modulePath) {
    var module = require.cache[modulePath];
    // remove reference for cache
    module.parent && module.parent.children.splice(module.parent.children.indexOf(module), 1);
    module = null;
    require.cache[modulePath] = null;
    delete require.cache[modulePath];
}
