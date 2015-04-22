yog2-plugin-recv-reload

========================

通过yog2-plugin-recv-reload，可以实现在使用YOG2框架进行开发工作时，上传APP代码无需重启服务就可以调试最新代码

## Usage

### 安装插件

```
yog2 plugin install https://github.com/hefangshi/yog2-plugin-recv-reload
```

### 开启插件

设定环境变量 `YOG_DEBUG` 为 `true`

```
export YOG_DEBUG=true
```

或者直接使用调试命令启动yog2

```
npm run debug
npm run debug-win // for windows
```

### APP配置

配置yog2 app，设置远程deploy接收端为recv-reload插件

```
//fis-conf.js

fis.config.set('deploy', {
    'remote': {
        from: '/',
        to: '/',
        receiver: 'http://yourhost:port/yog/upload'
    }
});
```

### 发布使用

在配置工作完成后，我们就可以通过yog2 release来发布和调试我们的最新代码了

```
yog2 release -d remote
```
