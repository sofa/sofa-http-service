'use strict';
/* global sofa */

describe('sofa.httpService', function () {

    var httpService, q;

    beforeEach(function () {
        q = new sofa.QService();
        httpService = new sofa.HttpService(q);
    });

    it('should be defined', function () {
        expect(httpService).toBeDefined();
    });
});
