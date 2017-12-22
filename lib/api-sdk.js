/**
 * client for api call
 * Created by lintry on 2016/11/8.
 */
"use strict";

const _ = require('lodash'),
    axios = require('axios');

const ora = require('ora');

/**
 * create execute function
 * @param method
 * @returns {Function}
 */
function verbFunc (method) {
    method = method || 'get';

    return function (url, data, options) {
        options = options || {};
        let config = _.extend({}, options, {
            url: url,
            method: method
        });

        if (/post|put|patch/i.test(method)) {
            config.data = data; //put in form data
        } else {
            config.params = data; //put in querystring
        }

        if (!url) {
            throw new Error('target url can not be null!');
        }
        const spinner = ora('Loading...').start();
        return axios.request(config)
            .then(function (res) {
                let result = res.data;
                if (res.status !== 200) { //check http return status
                    result.status = res.status;
                    return result;
                }
                spinner.succeed("Success")
                return result;
            })
            .catch(function (e) {
                let res = e.response || {};
                spinner.fail("Fail " + e.message)
                return {message: e.message, status: res.status, statusText: res.statusText, data: res.data};
            })
    };
}

module.exports = {
    get: verbFunc('get'),
    head: verbFunc('head'),
    post: verbFunc('post'),
    put: verbFunc('put'),
    patch: verbFunc('patch'),
    'delete': verbFunc('delete')
};
