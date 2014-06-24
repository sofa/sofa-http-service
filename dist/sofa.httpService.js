/**
 * sofa-http-service - v0.4.0 - 2014-06-24
 * http://www.sofa.io
 *
 * Copyright (c) 2014 CouchCommerce GmbH (http://www.couchcommerce.com / http://www.sofa.io) and other contributors
 * THIS SOFTWARE CONTAINS COMPONENTS OF THE SOFA.IO COUCHCOMMERCE SDK (WWW.SOFA.IO).
 * IT IS PROVIDED UNDER THE LICENSE TERMS OF THE ATTACHED LICENSE.TXT.
 */
;(function (sofa, window, undefined) {

'use strict';
/* global sofa */
/* global XMLHttpRequest */

sofa.define('sofa.HttpService', function ($q) {

    var JSON_START = /^\s*(\[|\{[^\{])/,
        JSON_END = /[\}\]]\s*$/,
        PROTECTION_PREFIX = /^\)\]\}',?\n/,
        CONTENT_TYPE_APPLICATION_JSON = {
            'Content-Type': 'application/json;charset=utf-8'
        },
        ABORTED = -1;

    var rawDocument = window.document;

    function encodeUriQuery(val, pctEncodeSpaces) {
        return encodeURIComponent(val)
                    .replace(/%40/gi, '@')
                    .replace(/%3A/gi, ':')
                    .replace(/%24/g, '$')
                    .replace(/%2C/gi, ',')
                    .replace(/%20/g, (pctEncodeSpaces ? '%20' : '+'));
    }

    function indexOf(array, obj) {
        if (array.indexOf) {
            return array.indexOf(obj);
        }

        for (var i = 0; i < array.length; i++) {
            if (obj === array[i]) {
                return i;
            }
        }
        return -1;
    }

    var isString = sofa.Util.isString,
        toJson = sofa.Util.toJson,
        isObject = sofa.Util.isObject,
        isFunction = sofa.Util.isFunction,
        isUndefined = sofa.Util.isUndefined,
        isDefined = function (value) {
            return !isUndefined(value);
        },
        isArray = sofa.Util.isArray,
        forEach = sofa.Util.forEach,
        extend = sofa.Util.extend;


    var fromJson = function (json) {
        return sofa.Util.isString(json) ? JSON.parse(json) : json;
    };

    var lowercase = function (string) {
        return isString(string) ? string.toLowerCase() : string;
    };

    var uppercase = function (string) {
        return isString(string) ? string.toUpperCase() : string;
    };

    var trim = function (value) {
        return isString(value) ? value.trim() : value;
    };

    function transformData(data, headers, fns) {
        if (isFunction(fns)) {
            return fns(data, headers);
        }

        forEach(fns, function (fn) {
            data = fn(data, headers);
        });

        return data;
    }

    function isSuccess(status) {
        return 200 <= status && status < 300;
    }

    function createXhr() {
        return new XMLHttpRequest();
    }

    function headersGetter(headers) {
        var headersObj = isObject(headers) ? headers : undefined;

        return function (name) {
            if (!headersObj) {
                headersObj =  parseHeaders(headers);
            }

            if (name) {
                return headersObj[lowercase(name)] || null;
            }

            return headersObj;
        };
    }

    function parseHeaders(headers) {
        var parsed = {}, key, val, i;

        if (!headers) {
            return parsed;
        }

        forEach(headers.split('\n'), function (line) {
            i = line.indexOf(':');
            key = lowercase(trim(line.substr(0, i)));
            val = trim(line.substr(i + 1));

            if (key) {
                if (parsed[key]) {
                    parsed[key] += ', ' + val;
                } else {
                    parsed[key] = val;
                }
            }
        });

        return parsed;
    }

    var defaults = this.defaults = {
        // transform incoming response data
        transformResponse: [function (data) {
            if (isString(data)) {
                // strip json vulnerability protection prefix
                data = data.replace(PROTECTION_PREFIX, '');
                if (JSON_START.test(data) && JSON_END.test(data)) {
                    data = fromJson(data);
                }
            }
            return data;
        }],

        // transform outgoing request data
        transformRequest: [function (d) {
            return isObject(d) ? toJson(d) : d;
        }],

        // default headers
        headers: {
            common: {
                'Accept': 'application/json, text/plain, */*'
            },
            post:   sofa.Util.clone(CONTENT_TYPE_APPLICATION_JSON),
            put:    sofa.Util.clone(CONTENT_TYPE_APPLICATION_JSON),
            patch:  sofa.Util.clone(CONTENT_TYPE_APPLICATION_JSON)
        },

        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN'
    };

    var httpService = function (requestConfig) {

        var config = {
            method: 'get',
            transformRequest: defaults.transformRequest,
            transformResponse: defaults.transformResponse
        };

        var headers = mergeHeaders(requestConfig);

        extend(config, requestConfig);
        config.headers = headers;
        config.method = uppercase(config.method);

        var serverRequest = function (config) {
            headers = config.headers;
            var reqData = transformData(config.data, headersGetter(headers), config.transformRequest);

            // strip content-type if data is undefined
            if (isUndefined(config.data)) {
                forEach(headers, function (value, header) {
                    if (lowercase(header) === 'content-type') {
                        delete headers[header];
                    }
                });
            }

            if (isUndefined(config.withCredentials) && !isUndefined(defaults.withCredentials)) {
                config.withCredentials = defaults.withCredentials;
            }

            // send request
            return sendReq(config, reqData, headers).then(transformResponse, transformResponse);
        };

        var chain = [serverRequest, undefined];
        var promise = $q.when(config);

        while (chain.length) {
            var thenFn = chain.shift();
            var rejectFn = chain.shift();

            promise = promise.then(thenFn, rejectFn);
        }

        return promise;

        function transformResponse(response) {
            // make a copy since the response must be cacheable
            var resp = extend({}, response, {
                data: transformData(response.data, response.headers, config.transformResponse)
            });
            return (isSuccess(response.status)) ? resp : $q.reject(resp);
        }

        function mergeHeaders(config) {
            var defHeaders = defaults.headers,
                reqHeaders = extend({}, config.headers),
                defHeaderName, lowercaseDefHeaderName, reqHeaderName;

            defHeaders = extend({}, defHeaders.common, defHeaders[lowercase(config.method)]);

            // execute if header value is function
            execHeaders(defHeaders);
            execHeaders(reqHeaders);

            // using for-in instead of forEach to avoid unecessary iteration after header has been found
            defaultHeadersIteration:
            for (defHeaderName in defHeaders) {
                lowercaseDefHeaderName = lowercase(defHeaderName);

                for (reqHeaderName in reqHeaders) {
                    if (lowercase(reqHeaderName) === lowercaseDefHeaderName) {
                        continue defaultHeadersIteration;
                    }
                }
                reqHeaders[defHeaderName] = defHeaders[defHeaderName];
            }

            return reqHeaders;

            function execHeaders(headers) {
                var headerContent;

                forEach(headers, function (headerFn, header) {
                    if (isFunction(headerFn)) {
                        headerContent = headerFn();
                        if (headerContent !== null) {
                            headers[header] = headerContent;
                        } else {
                            delete headers[header];
                        }
                    }
                });
            }
        }
    };

    httpService.pendingRequests = [];
    httpService.callbacks = {
        counter: 0
    };
    httpService.defaults = defaults;

    function sortedKeys(obj) {
        var keys = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                keys.push(key);
            }
        }
        return keys.sort();
    }

    function forEachSorted(obj, iterator, context) {
        var keys = sortedKeys(obj);
        for (var i = 0; i < keys.length; i++) {
            iterator.call(context, obj[keys[i]], keys[i]);
        }
        return keys;
    }

    function buildUrl(url, params) {
        if (!params) {
            return url;
        }
        var parts = [];
        forEachSorted(params, function (value, key) {
            if (value === null || isUndefined(value)) {
                return;
            }

            if (!isArray(value)) {
                value = [value];
            }

            forEach(value, function (v) {
                if (isObject(v)) {
                    v = toJson(v);
                }
                parts.push(encodeUriQuery(key) + '=' +
                            encodeUriQuery(v));
            });
        });

        if (parts.length > 0) {
            url += ((url.indexOf('?') === -1) ? '?' : '&') + parts.join('&');
        }
        return url;
    }

    function sendReq(config, reqData, reqHeaders) {
        var deferred = $q.defer(),
            promise = deferred.promise,
            cache,
            cachedResp,
            url = buildUrl(config.url, config.params);

        httpService.pendingRequests.push(config);
        promise.then(removePendingReq, removePendingReq);


        // if we won't have the response in cache, send the request to the backend
        if (isUndefined(cachedResp)) {
            doActualRequest(config.method, url, reqData, done, reqHeaders, config.timeout,
                config.withCredentials, config.responseType);
        }

        return promise;


        /**
        * Callback registered to $httpBackend():
        *  - caches the response if desired
        *  - resolves the raw $http promise
        *  - calls $apply
        */
        function done(status, response, headersString) {
            if (cache) {
                if (isSuccess(status)) {
                    cache.put(url, [status, response, parseHeaders(headersString)]);
                } else {
                    // remove promise from the cache
                    cache.remove(url);
                }
            }

            resolvePromise(response, status, headersString);
        }


        /**
        * Resolves the raw $http promise.
        */
        function resolvePromise(response, status, headers) {
            // normalize internal statuses to 0
            status = Math.max(status, 0);

            (isSuccess(status) ? deferred.resolve : deferred.reject)({
                data: response,
                status: status,
                headers: headersGetter(headers),
                config: config
            });
        }


        function removePendingReq() {
            var idx = indexOf(httpService.pendingRequests, config);
            if (idx !== -1) {
                httpService.pendingRequests.splice(idx, 1);
            }
        }
    }

    function doActualRequest(method, url, post, callback, headers, timeout, withCredentials, responseType) {

        var status;
        url = url;
        var callbacks = httpService.callbacks;

        if (lowercase(method) === 'jsonp') {
            var callbackId = '_' + (callbacks.counter++).toString(36);
            callbacks[callbackId] = function (data) {
                callbacks[callbackId].data = data;
            };

            var jsonpDone = jsonpReq(url.replace('JSON_CALLBACK', 'sofa.callbacks.' + callbackId),  function () {
                if (callbacks[callbackId].data) {
                    completeRequest(callback, 200, callbacks[callbackId].data);
                } else {
                    completeRequest(callback, status || -2);
                }
                callbacks[callbackId] = function () {};
            });
        } else {
            var xhr = createXhr(method);

            xhr.open(method, url, true);
            forEach(headers, function (value, key) {
                if (isDefined(value)) {
                    xhr.setRequestHeader(key, value);
                }
            });

            // In IE6 and 7, this might be called synchronously when xhr.send below is called and the
            // response is in the cache. the promise api will ensure that to the app code the api is
            // always async
            xhr.onreadystatechange = function () {
                // onreadystatechange might get called multiple times with readyState === 4 on mobile webkit caused by
                // xhrs that are resolved while the app is in the background (see #5426).
                // since calling completeRequest sets the `xhr` variable to null, we just check if it's not null before
                // continuing
                //
                // we can't set xhr.onreadystatechange to undefined or delete it because that breaks IE8 (method=PATCH) and
                // Safari respectively.
                if (xhr && xhr.readyState === 4) {
                    var responseHeaders = null,
                        response = null;

                    if (status !== ABORTED) {
                        responseHeaders = xhr.getAllResponseHeaders();

                        // responseText is the old-school way of retrieving response (supported by IE8 & 9)
                        // response/responseType properties were introduced in XHR Level2 spec (supported by IE10)
                        response = ('response' in xhr) ? xhr.response : xhr.responseText;
                    }

                    completeRequest(callback,
                        status || xhr.status,
                        response,
                        responseHeaders);
                }
            };

            if (responseType) {
                try {
                    xhr.responseType = responseType;
                } catch (e) {
                    // WebKit added support for the json responseType value on 09/03/2013
                    // https://bugs.webkit.org/show_bug.cgi?id=73648. Versions of Safari prior to 7 are
                    // known to throw when setting the value "json" as the response type. Other older
                    // browsers implementing the responseType
                    //
                    // The json response type can be ignored if not supported, because JSON payloads are
                    // parsed on the client-side regardless.
                    if (responseType !== 'json') {
                        throw e;
                    }
                }
            }

            xhr.send(post || null);
        }

        function completeRequest(callback, status, response, headersString) {

            jsonpDone = xhr = null;
            // fix status code when it is 0 (0 status is undocumented).
            // Occurs when accessing file resources.
            // On Android 4.1 stock browser it occurs while retrieving files from application cache.
            status = (status === 0) ? (response ? 200 : 404) : status;
            callback(status, response, headersString);
        }

        function jsonpReq(url, done) {
            // we can't use jQuery/jqLite here because jQuery does crazy shit with script elements, e.g.:
            // - fetches local scripts via XHR and evals them
            // - adds and immediately removes script elements from the document
            var script = rawDocument.createElement('script'),
                doneWrapper = function () {
                    script.onreadystatechange = script.onload = script.onerror = null;
                    rawDocument.body.removeChild(script);
                    if (done) {
                        done();
                    }
                };

            script.type = 'text/javascript';
            script.src = url;

            script.onload = script.onerror = function () {
                doneWrapper();
            };

            rawDocument.body.appendChild(script);
            return doneWrapper;
        }
    }

    var createShortMethods = function () {
        forEach(arguments, function (name) {
            httpService[name] = function (url, config) {
                return httpService(extend(config || {}, {
                    method: name,
                    url: url
                }));
            };
        });
    };

    var createShortMethodsWithData = function () {
        forEach(arguments, function (name) {
            httpService[name] = function (url, data, config) {
                return httpService(extend(config || {}, {
                    method: name,
                    url: url,
                    data: data
                }));
            };
        });
    };

    createShortMethods('get', 'jsonp');
    createShortMethodsWithData('post');

    return httpService;
});

} (sofa, window));
