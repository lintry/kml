# 私有模块加载管理器


[![NPM](https://nodei.co/npm/kml-cli.png)](https://nodei.co/npm/kml-cli/)
> 基于git服务进行私有模块管理，需要kml-server提供模块服务



## 安装

```sh
git clone git@gitlab.kmlab.com:npms/kml.git
cd kml
#本地全局安装
npm link

#更新版本，同步更新git即可
git pull origin master
```

## 使用

```sh
#帮助提示
kml --help
```

## 依赖规则

+ kml命令必须在符合npm模块结构的目录中运行，当前目录下可以找到package.json。当前目录已经进行了git管理，后续指令操作会用到git命令。
+ kml模块必须在package.json中的模块名为kml-开头，便于在npm安装后和公共模块区分
+ package.json中的version必须标记，并在每次升级版本后修改。建议把对应的master分支上标记和version相同的tag。可以使用git-flow进行发布，也可以从develop分支合并到master后，标记tag。
+ kml的register和publish指令会在运行前检查package.json中的version是否存在tag，如果不存在则在当前分支下自动创建同名tag并提交服务。
+ 安装模块时默认安装最新master分支版本，如果指定版本则在模块名后加“@版本号”，同时安装同名的tag。如果tag不存在则安装失败。

