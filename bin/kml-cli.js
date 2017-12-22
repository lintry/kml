#!/usr/bin/env node
const path = require('path'),
    fs = require('fs-extra'),
    util = require('util'),
    url_utils = require('url'),
    program = require('commander'),
    chalk = require('chalk'),
    shell = require('shelljs'),
    api_sdk = require('../lib/api-sdk'),
    PKG = require('../package.json'),
    Table = require('cli-table2'),
    inquirer = require('inquirer')
;

const
    PRE_FIX_EXP = /^kml-[\w\-.@#]+$/,
    KMLRC = path.join(process.env.HOME||'/', '.kmlrc');

const default_host = {current: '', list: {}}
//RC file init
fs.ensureFileSync(KMLRC);
let rc_obj = fs.readJsonSync(KMLRC, {throws: false});
if (!rc_obj) {
    rc_obj = {
        host: default_host
    };

    fs.writeJsonSync(KMLRC, rc_obj);
} else {
    let to_save = false;
    if (!rc_obj.host) {
        rc_obj.host = default_host;
        to_save = true;
    }

    if (!rc_obj.host.list) {
        rc_obj.list = {}
        to_save = true;
    }

    to_save && fs.writeJsonSync(KMLRC, rc_obj);
}

//host in config
const HOST_CFG = rc_obj.host,
    HOST = HOST_CFG.list[HOST_CFG.current];

const check_host = function () {
    if (!HOST_CFG.list || !Object.keys(HOST_CFG.list).length) {
        // to add new host
        console.error(chalk.red('You should add a host first!'));
        process.exit(-1);
    }

    if (!HOST_CFG.current || !HOST) {
        // to choose a host
        console.warn(chalk.yellow('Choose a host first!'));
        console.warn(chalk.green('Try command ') + chalk.cyan('kml host '));
        process.exit(-1);
    }
}

program
    .version(PKG.version);

program
    .command('install [pkgs...]')
    .alias('i')
    .description('install <pkg> <pkg> <pkg>')
    .option('-S --save', 'save mode')
    .option('-D --save-dev', 'save dev mode')
    .option('-g --global', 'global module')
    .action(install);

program
    .command('uninstall [pkgs...]')
    .alias('un')
    .description('uninstall <pkg> <pkg> <pkg>')
    .option('-S --save', 'save mode')
    .option('-D --save-dev', 'save dev mode')
    .option('-g --global', 'global module')
    .action(uninstall);

program
    .command('list [pkgs...]')
    .alias('ls')
    .description('list some packages')
    .action(function (pkgs) {
        if (Array.isArray(pkgs) && pkgs.length === 1) {
            pkgs = pkgs[0];
        }

        list(pkgs)
            .then(function (result) {
                let content = result.content || {};
                if (content.package_list) {
                    _print_array(content);
                } else {
                    _print_object(content);
                }
            });
    });

program
    .command('publish')
    .alias('push')
    .option('-f --force', 'force to replace exists version')
    .description('publish the package of current folder')
    .action(function (opts) {
        publish(opts);
    });

program
    .command('register')
    .alias('reg')
    .description('register a new package from current folder')
    .action(function () {
        register();
    });

program
    .command('host')
    .description(`list kml-server hosts. (Specify configs in the json file:${KMLRC})`)
    .option('-v, --host-version', 'show current host version')
    .action(function (opts) {
        list_host(opts);
    });

program
    .command('add <host>')
    .option('-n --host-name [value]', 'alias for host')
    .description('add a kml-server host')
    .action(add_host);

program
    .command('remove <name>')
    .description('remove a kml-server host')
    .action(remove_host);

program
    .command('use <host>')
    .description('use a kml-server host')
    .action(function (host) {
        use_host(host);
    });

program
    .command('check [pkgs...]')
    .description('check packages')
    .option('-D, --dev', 'check development dependencies')
    .action(function (pkgs, opts) {
        check(pkgs, opts.dev);
    });

program
    .command('upgrade [pkgs...]')
    .description('upgrade packages')
    .option('-D, --dev', 'upgrade development dependencies')
    .action(function (pkgs, opts) {
        upgrade(pkgs, opts.dev);
    });

program
    .command('relation [pkg]')
    .alias('rela')
    .description('query relations of pack')
    .action(function (pkg) {
        relation(pkg);
    });

program
    .parse(process.argv);

if (process.argv.length === 2) {
    program.outputHelp();
}


/**
 * print object content
 * @param content
 * @private
 */
function _print_object(content) {
    for (let k in content) {
        let v = content[k];
        if (k === 'url') {
            v = git_url(v);
        }
        if (typeof v === 'object') {
            console.info(k + ':');
            for (let i in v) {
                console.info(`${i}: ${v[i]}`);
            }
        } else {
            console.info(`${k}: ${v}`);
        }
    }
}

/**
 * print array format
 * @param content
 * @private
 */
function _print_array(content) {
    if (content && content.package_list) {
        content.package_list.forEach(function (pkg) {
            console.info(chalk.bold.green(`${pkg.id}: ${git_url(pkg.url)}#${pkg.version}`));
            console.info(chalk.bold(pkg.description));
            console.log();
        })
    }
}

/**
 * get current git status
 * @return {{branch: string, initial: boolean, remote: string}}
 */
function get_git_status() {
    let ret = shell.exec('git status --porcelain --branch', {silent: true});
    let branch = '', initial = false, remote_branch = '';
    if (ret.code === 0) {
        let git_status = ret.stdout.split('\n')[0].match(/^##\s*(.+)/)[1].trim();
        if (git_status) {
            if (/Initial commit on/.test(git_status)) {
                branch = git_status.split(' ');
                branch = branch[branch.length - 1];
                initial = true;
            } else if (/no branch/.test(git_status)) {
                branch = 'tag name'
            } else {
                let gs = git_status.split('...');
                branch = gs[0];
                remote_branch = gs[1] || '';
            }
        }
    }

    return {branch: branch, initial: initial, remote_branch: remote_branch};
}


/**
 * current package infomation
 * @param readonly Don't modify current git tag
 * @returns {{id: (string), description: (string), type: string, url: (string), version: (string), branch: *, commit: *}}
 * @private
 */
function _package_info(readonly) {
    let git_status = get_git_status();
    let branch = git_status.branch;
    console.log('current branch is ', branch);
    let commit = shell.exec(`git rev-parse HEAD`, {silent: true}).stdout.trim();
    console.log('current commit is ', commit);

    let package_json_path = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(package_json_path)) {
        return {};
    }
    let package_json = fs.readJsonSync(package_json_path, {throws: false});
    let version = package_json.version;
    if (!version) {
        console.error(chalk.red('Can not find version in package'));
        process.exit(1);
    }
    let local_tag = shell.exec(`git tag -l ${version}`, {silent: true}).stdout;
    local_tag = local_tag && local_tag.trim();
    if (!readonly && local_tag !== version) {
        console.info('Ready to add git tag', chalk.green(version));
        shell.exec(`git tag ${version}`, {silent: true});
        let ret = shell.exec(`git push origin ${version}`, {silent: true});
        if (ret.code !== 0) {
            console.error(chalk.styles.red.open, ret.stdout, chalk.styles.close);
            process.exit(-100);
        }
    }
    return {
        id: package_json.name,
        description: package_json.description,
        type: package_json.repository && package_json.repository.type,
        url: package_json.repository && git_url(package_json.repository.url),
        version: version,
        branch: branch,
        commit: commit,
        initial: git_status.initial,
        remote_branch: git_status.remote_branch
    };
}

/**
 * check package name format
 * @param pkgs
 * @returns {Array}
 * @private
 */
function _check_pkgs(pkgs) {
    let wrong_mods = [], mods = [];
    pkgs.forEach(function (pkg) {
        if (PRE_FIX_EXP.test(pkg)) {
            mods.push(pkg);
        } else {
            wrong_mods.push(pkg);
        }
    });

    wrong_mods.length && console.error(`Wrong kml-package name ->${chalk.red(wrong_mods.join(' '))}<-!`);

    return mods;
}

/**
 * list packages
 * @param pkgs String: a single package name, Array: name of packages
 * @returns {*}
 */
function list(pkgs) {
    check_host()
    pkgs = pkgs || '';
    let cmd = url_utils.resolve(HOST, 'api/pack/list');
    if (typeof pkgs === 'string') {
        cmd += '/' + pkgs;
    }
    if (Array.isArray(pkgs) && pkgs.length > 0) {
        return api_sdk.post(cmd, {ids: pkgs});
    } else {
        return api_sdk.get(cmd);
    }
}

/**
 * convert separator of group in git url, from NPM 5.0
 * Sample：from "git+ssh://git@gitlab.mycompany.com:group/package.git" to "git+ssh://git@gitlab.mycompany.com/group/package.git"
 * @param url
 */
function git_url(url) {
    return url.replace(/([\w\+]+\:\/\/\w+@[\w-_\.]+)(\:)([\w-_]+\/.+)/g, '$1/$3');
}
/**
 * install package
 * @param pkgs
 * @param opts
 */
function install(pkgs, opts) {
    let options = [];
    opts.save && options.push('--save');
    opts.saveDev && options.push('--save-dev');
    opts.global && options.push('-g');

    let package_info = _package_info(true);
    let commands = [], mods = _check_pkgs(pkgs), installed = [];
    if (mods.length) {
        check_host();
        return list(mods)
            .then(function (result) {
                let content = result.content, packs = content.package_list;
                if (packs && packs.length) {
                    packs.forEach(function (pkg) {
                        commands.push(git_url(pkg.url));
                        installed.push(pkg.id);
                    });

                    let cmd = `npm install ${commands.join(' ')} ${options.join(' ')}`;
                    console.info(chalk.yellow('RUNNING:', cmd));
                    let exec = shell.exec(cmd);
                    if (exec.code === 0) {
                        console.info(chalk.green(`${chalk.green(installed.join((' ')))} installed successfully!`));
                        return true;
                    } else {
                        console.error(chalk.red(exec.stderr));
                        return false;
                    }
                }
            })
            .then(function (success) {
                return success && api_sdk.post(url_utils.resolve(HOST, 'api/pack/install'), {
                        package_info: package_info,
                        installed: installed
                    })
            })
            .catch(function (e) {
                console.error(chalk.styles.red.open, e, chalk.styles.red.close);
            });
    } else {
        console.info(chalk.yellow('NOTHING IS INSTALLED!'))
    }
}

/**
 * remove package
 * @param pkgs
 * @param opts
 */
function uninstall(pkgs, opts) {
    let options = [];
    opts.save && options.push('--save');
    opts.saveDev && options.push('--save-dev');
    opts.global && options.push('-g');

    let mods = _check_pkgs(pkgs);
    let package_info = _package_info(true);
    if (mods.length) {
        check_host();
        let cmd = `npm uninstall ${mods.join(' ')} ${options.join(' ')}`;
        console.info(chalk.yellow('RUNNING:', cmd));
        let exec = shell.exec(cmd, {silent: true});
        if (exec.code === 0) {
            console.info(chalk.green(`${chalk.green(mods.join((' ')))} uninstalled successfully!`));
            return api_sdk.post(url_utils.resolve(HOST, 'api/pack/uninstall'), {
                package_info: package_info,
                uninstalled: mods
            })
        } else {
            console.error(chalk.red(exec.stderr));
        }
    } else {
        console.info(chalk.yellow('NOTHING IS UNINSTALLED!'))
    }
}

/**
 * public updates
 */
function publish(opts) {
    let package_info = _package_info();
    if (!PRE_FIX_EXP.test(package_info.id)) {
        console.error(chalk.red('Wrong package name', package_info.id));
        return;
    }
    check_host();
    let cmd = url_utils.resolve(HOST, 'api/pack/publish/' + package_info.id);
    package_info.force = opts.force;
    if (opts.force) {
        let version = package_info.version;

        //强制刷新本地和远端的tag
        shell.exec(`git tag -f ${version}`, {silent: true});
        let ret = shell.exec(`git push origin -f ${version}`, {silent: true});
        if (ret.code !== 0) {
            console.error(chalk.styles.red.open, ret.error, chalk.styles.close);
            return {};
        }
    }
    api_sdk.post(cmd, package_info)
        .then(function (result) {
            let color = (result.ret === 'OK') ? chalk.green : chalk.red;
            console.info(color(`publish ${package_info.id} is ${result.ret}`));
            result.msg && console.info(color(result.msg));
            _print_object(result.content);
        })
}

/**
 * register a new package
 */
function register() {
    let package_info = _package_info();
    if (!PRE_FIX_EXP.test(package_info.id)) {
        console.error(chalk.red('Wrong package name', package_info.id));
        return;
    }
    check_host();
    let cmd = url_utils.resolve(HOST, 'api/pack/register/' + package_info.id);
    api_sdk.post(cmd, package_info)
        .then(function (result) {
            let color = (result.ret === 'OK') ? chalk.green : chalk.red;
            console.info(color(`register ${package_info.id} is ${result.ret}`));
            result.msg && console.info(color(result.msg));
            _print_object(result.content);
        })
}

/**
 * list all host
 */
function list_host(opts) {
    let host = rc_obj.host, current = host.current, list = host.list;
    if (opts.hostVersion) {
        check_host();
        let cmd = url_utils.resolve(HOST, 'api/pack/version');
        api_sdk.get(cmd)
            .then(function (result) {
                let color = (result.ret === 'OK') ? chalk.white : chalk.red;
                let content = result.content || {};
                console.info(color(`current host version is ${content.version}`));
            });
    } else {
        if (!list || !Object.keys(list).length) {
            console.warn(chalk.red('You should add a host first'))
            process.exit(-5)
        }
        let name_list = [];
        for (let k in list) {
            if (list.hasOwnProperty(k)) {
                name_list.push({
                    name: chalk.blue(k + ': ' + list[k]),
                    value: k,
                    short: k,
                    disabled: (current === k) ? chalk.green('Current used') : ''
                })
            }
        }
        return inquirer.prompt([
            {
                type: 'list',
                name: 'host',
                message: chalk.cyan('Which host to choose? (Ctrl-C to break)'),
                choices: name_list
            }])
            .then(answers => {
                if (answers.host) {
                    return use_host(answers.host)
                } else {
                    console.warn(chalk.red('You choosed noting'))
                }


            })
    }
}

/**
 * add a new host
 * @param new_host host url
 * @param opts
 */
function add_host (new_host, opts) {
    let host_url = url_utils.parse(new_host);
    if (!host_url.hostname) {
        console.error(chalk.red('Host must be a regular url'))
        process.exit(-1);
    }
    let name = opts.hostName;
    if (typeof name !== 'string') {
        name = host_url.hostname.split('.')[0];
        if (!name) {
            console.error(chalk.magenta('Host must be a regular url'))
            process.exit(-2);
        }
    }

    let list = HOST_CFG.list;
    if (list[name]) {
        console.warn(chalk.yellow(name + ' is exists, you can remove it first'));
        process.exit(-3);
    }

    list[name] = new_host;
    fs.writeJsonSync(KMLRC, rc_obj);
    console.info(chalk.green(new_host + ' has been added as "' + name + '"'))
}

/**
 * remove a exists host
 * @param name
 */
function remove_host (name) {
    let list = HOST_CFG.list;
    if (!list[name]) {
        console.warn(chalk.yellow(name + ' is not exists'));
        process.exit(-4);
    }

    delete list[name];

    if (HOST_CFG.current === name) {
        HOST_CFG.current = Object.keys(list)[0] || '';
    }
    fs.writeJsonSync(KMLRC, rc_obj);
    console.info(chalk.green(name + ' has been removed'))
}

/**
 * use host
 * @param assigned_host
 */
function use_host(assigned_host) {
    if (!assigned_host) {
        console.error(chalk.red(`current host is not defined!`));
        process.exit(1);
    }
    let host = rc_obj.host, list = host.list;
    if (!list[assigned_host]) {
        console.error(chalk.red(`${assigned_host} is not exists!`));
        process.exit(1);
    }

    host.current = assigned_host;
    fs.writeJsonSync(KMLRC, rc_obj);
    console.info(`${assigned_host} is current host now!`)
    return list[assigned_host];
}

/**
 * check package for update
 * @param pkgs
 * @param dev
 * @returns {Promise<R2|R1>|Promise.<Result>|Promise<R>}
 */
function check(pkgs, dev) {
    let mods = [], checked = [];
    let root_path = process.cwd();
    check_host();
    let package_info = _package_info(true);
    //获取本地package.json的kml包
    let local_json_file = path.resolve(root_path, 'package.json');
    if (!fs.existsSync(local_json_file)) {
        console.log(chalk.red(local_json_file + ' can not be found'));
        process.exit(0);
    }
    let pkg_json = fs.readJsonSync(local_json_file, {throws: false});
    if (pkgs && pkgs.length) {
        mods = _check_pkgs(pkgs);
    } else {
        let deps = (dev ? pkg_json.devDependencies : pkg_json.dependencies) || {};
        for (let k in deps) {
            PRE_FIX_EXP.test(k) && mods.push(k);
        }
    }

    if (mods.length) {
        let installed = [], comp_map = {};
        mods.forEach(function (mod) {
            let mod_json_file = path.resolve(root_path, 'node_modules', mod, 'package.json');
            if (!fs.existsSync(mod_json_file)) {
                console.log(chalk.blue(mod + ' can not be found, ignore it'));
                return;
            }
            let mod_json = fs.readJsonSync(mod_json_file, {throws: false});
            if (mod_json) {
                installed.push({id: mod, version: mod_json.version});
                comp_map[mod] = {local: mod_json.version}
            }
        });
        return list(mods)
            .then(function (result) {
                let content = result.content, packs = content.package_list, to_upgrade = [], installed_mod = [];
                if (packs && packs.length) {

                    packs.forEach(function (pkg) {
                        checked.push({id: pkg.id, version: pkg.version});
                        let comp = comp_map[pkg.id];
                        if (comp) {
                            comp.remote = pkg.version;
                        } else {
                            comp_map[pkg.id] = {remote: pkg.version};
                        }

                        installed_mod.push(pkg.id);
                    });

                    //打印比较结构
                    for (let k in comp_map) {
                        let comp = comp_map[k];
                        let need_upgrade = (comp.local === comp.remote) ? '' : '*';
                        let color = need_upgrade ? chalk.magenta : chalk.blue;
                        need_upgrade && to_upgrade.push(k);
                        console.info(chalk.cyan(k), color(comp.local || ''), color(comp.remote || ''), chalk.red(need_upgrade));
                    }
                }
                return api_sdk.post(url_utils.resolve(HOST, 'api/pack/install'), {
                    package_info: package_info,
                    installed: installed_mod
                })
                    .then(function () {
                        return to_upgrade;
                    })
            })
    } else {
        console.info(chalk.yellow('NOTHING IS CHECKED!'));
        process.exit(0);
    }
}

/**
 * upgrade package
 * @param pkgs
 * @param dev
 * @returns {Promise<R2|R1>|Promise.<Result>|Promise<R>}
 */
function upgrade(pkgs, dev) {
    return check(pkgs, dev)
        .then(function (list) {
            if (list && list.length) {
                install(list, {save: !dev, saveDev: !!dev});
            }
        })
}

/**
 * find who use this package
 * @param pkg
 * @return {Promise<R>|Promise<R2|R1>|Promise.<TResult>}
 */
function relation(pkg) {
    if (!pkg) {
        let package_info = _package_info(true);
        if (!PRE_FIX_EXP.test(package_info.id)) {
            console.error(chalk.red(`package is not defined!`));
            process.exit(1);
        }
        pkg = package_info.id;
    }
    check_host();
    let cmd = url_utils.resolve(HOST, 'api/pack/relation/' + pkg);
    return api_sdk.get(cmd)
        .then(function (result) {
            let content = result.content || [], table = new Table({
                chars: {
                    'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗'
                    , 'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝'
                    , 'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼'
                    , 'right': '║', 'right-mid': '╢', 'middle': '│'
                },
                head: ['Name', 'Version', 'Description']
                // , colWidths: [40, 20, 50]
            });

            content.forEach(function (item) {
                table.push([item.name, item.version, item.description]);
            });

            console.log(table.toString());
        })
}