"use strict";

const shell = require('shelljs'),
    chalk = require('chalk');

const cwd = `/Users/lintry/Git/t`;
function get_current_branch(sh) {
    let ret = sh.exec('git status --porcelain --branch', { silent: true, cwd: cwd });
    let branch = '', initial = false, remote = '';
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
                remote = gs[1] || '';
            }
        }
    }

    return {branch: branch, initial: initial, remote: remote};
}

let branch = get_current_branch(shell);
console.log(chalk.styles.green.open, 'current branch is ', branch, chalk.styles.green.close)
