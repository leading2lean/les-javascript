/**
 * This is an example program for how to use the L2L Dispatch API to read and write data in the Dispatch system.
 *
 * The code is written to run on Node 12.17.0+ (should work in 8+ due to async/await features). You need to make sure
 * Node and NPM are both installed and running properly on your system.
 *
 * Then you need to install the dependencies (axios and yargs) with a command like:
 *      $ npm i
 *
 * To then run this code, you would then run:
 *      $ node index.js
 */

// We use an external library axios to handle HTTP requests and posts, and querystring to convert obj -> post form data
const axios = require('axios');
const qs = require('querystring');

// We use an external library yargs to handle CLI options much easier than process.argv() built into node
const { dbg, server, apikey, site, user } = require('yargs')
    .usage('Usage: Node $0 [options]')
    .options({
        dbg: {
            describe: 'Print out verbose api output for debugging',
            nargs: 0,
            type: 'boolean',
        },
        server: {
            describe: 'Specify a hostname to use as the server',
            type: 'string',
            nargs: 1,
            demandOption: true,
        },
        site: {
            describe: 'Specify the site id to operate against',
            type: 'number',
            nargs: 1,
            demandOption: true,
        },
        user: {
            describe: 'Specify the username for a user to use in the test',
            type: 'string',
            nargs: 1,
            demandOption: true,
        },
        // This example has you pass your API key in on the command line. Note that you should not do this in your
        // production code. The API Key MUST be kept secret, and effective secrets management is outside the scope
        // of this document. Make sure you don't hard code your api key into your source code, and usually you should
        // expose it to your production code through an environment variable.
        apikey: {
            describe: 'Specify an API key to use for authentication',
            type: 'string',
            nargs: 1,
            demandOption: true,
        },
    }).argv;

const baseUrl = `https://${server}/api/1.0/`,
    universalParams = { auth: apikey },
    postConfig = {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    };

// Using a self invoking async function to allow for await
(async function init() {
    try {
        /*-----------------------------------------------------------------------------------------------------------*/
        // This shows how to use the API to look up information about a Site. For this application, the specified site
        // must be a test site so that we can avoid any accidents with production data. For production code, you don't
        // need to do this kind of check as you'll need to work against production sites.

        // Note that we are using a function to check the api results - API calls can fail for a variety of reasons and
        // your code should make sure to check the results.  Also, API calls that read data should always use an HTTP
        // GET operation.

        // This shows an example of asking the api to list all Sites that are active, are a test site, and have the
        // specified site id using filter parameters in the query args. There must be only one item in the result list.
        let resp = data = undefined;

        resp = await axios.get(`${baseUrl}sites/`, getParams({ test_site: true, active: true, site: site }));

        const [siteData] = checkResponse(resp, true, true, 'site');
        universalParams.site = site;

        log(`Using site: ${siteData.description}`, siteData);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Now lets find an area/line/machine to use
        const limit = 2;
        let offset = 0,
            finished = false,
            areaData = undefined;

        while (!finished) {
            resp = await axios.get(`${baseUrl}areas/`, getParams({ inactive: 'F', limit, offset }));
            data = checkResponse(resp, true, true, 'area');

            // this means we hit the last page of possible results, so grab the last one in the array
            if (data.length < limit) {
                finished = true;
                if (data.length) {
                    areaData = data.slice(-1)[0];
                }
            } else {
                offset += data.length;
                areaData = data.slice(-1)[0];
            }
        }

        log(`Using area: ${areaData.code}`, areaData);

        // Grab a line in the area we've found that supports production
        resp = await axios.get(
            `${baseUrl}lines/`,
            getParams({
                area_id: areaData.id,
                inactive: 'F',
                enable_production: true,
            })
        );

        data = checkResponse(resp, true, true, 'line');
        const lineData = data.slice(-1)[0];
        log(`Using line: ${lineData.code}`, lineData);

        // Grab a machine on the line
        resp = await axios.get(
            `${baseUrl}machines/`,
            getParams({
                line_id: lineData.id,
                inactive: 'F',
            })
        );

        data = checkResponse(resp, true, true, 'machine');
        const machineData = data.slice(-1)[0];
        log(`Using machine: ${machineData.code}`, machineData);

        // Grab a dispatch tytpe
        resp = await axios.get(
            `${baseUrl}dispatchtypes/`,
            getParams({
                inactive: 'F',
            })
        );

        data = checkResponse(resp, true, true, 'dispatch type');
        const dispatchtypeData = data.slice(-1)[0];
        log(`Using dispatch type: ${dispatchtypeData.code}`, dispatchtypeData);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Let's record a user clock in to Dispatch to on our line we created previously.
        resp = await axios.post(
            `${baseUrl}users/clock_in/${user}/`,
            getParams({ linecode: lineData.code }, true),
            postConfig
        );
        data = checkResponse(resp, false);
        log('User clocked in', resp.data);

        // Now clock them out
        resp = await axios.post(
            `${baseUrl}users/clock_out/${user}/`,
            getParams({ linecode: lineData.code }, true),
            postConfig
        );
        data = checkResponse(resp, false);
        log('User clocked out', resp.data);

        // We can record a user clockin session in the past by supplying a start and an end parameter. These datetime
        // parameters in the API must be formatted consistently, and must represent the current time in the Site's
        // timezone (NOT UTC) unless otherwise noted in the API documentation.
        resp = await axios.post(
            `${baseUrl}users/clock_in/${user}/`,
            getParams(
                {
                    linecode: lineData.code,
                    start: new Date(new Date().setDate(new Date().getDate() - 7)),
                    end: new Date(new Date().setTime(new Date().getTime() + minutesToMs(480))), // 480 min = 8 hours
                },
                true
            ),
            postConfig
        );
        data = checkResponse(resp, false);
        log('Created backdated clock in', resp.data);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Let's call specific api's for the machine we created. Here we set the machine's cycle count, and then
        // we increment the machine's cycle count.
        resp = await axios.post(
            `${baseUrl}machines/set_cycle_count/`,
            getParams({ code: machineData.code, cyclecount: 832 }, true),
            postConfig
        );
        data = checkResponse(resp, false);
        log('Set machine cycle count', data);

        // This simulates a high frequency machine where we make so many calls to this we don't care about tracking the
        // lastupdated values for the machine cycle count.
        resp = await axios.post(
            `${baseUrl}machines/increment_cycle_count/`,
            getParams({ code: machineData.code, cyclecount: 5, skip_lastupdate: 1 }, true),
            postConfig
        );
        data = checkResponse(resp, false);
        log('Incremented machine cycle count', data);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Let's create a Dispatch for the machine to simulate an event that requires intervention
        resp = await axios.post(
            `${baseUrl}dispatches/open/`,
            getParams(
                { dispatchtype: dispatchtypeData.id, description: 'l2lsdk test dispatch', machine: machineData.id },
                true
            ),
            postConfig
        );
        data = checkResponse(resp);
        log('Created open Dispatch', data);

        // Now let's close it
        resp = await axios.post(`${baseUrl}dispatches/close/${data.id}`, getParams({}, true), postConfig);
        data = checkResponse(resp);
        log('Closed open Dispatch', data);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Let's add a Dispatch for the machine that represents an event that already happened and we just want to
        // record it
        resp = await axios.post(
            `${baseUrl}dispatches/add/`,
            getParams(
                {
                    dispatchtypecode: dispatchtypeData.code,
                    description: 'l2lsdk test dispatch (already closed)',
                    machinecode: machineData.code,
                    reported: new Date(new Date().setDate(new Date().getDate() - 60)), // 60 days
                    completed: new Date(new Date().setTime(new Date().getTime() + minutesToMs(34))),
                },
                true
            ),
            postConfig
        );
        data = checkResponse(resp);
        log('Created backdated Dispatch', data);

        /*-----------------------------------------------------------------------------------------------------------*/
        // Let's record some production data using the record_details api. This will create a 1 second pitch as we use
        // now both start and end. Typically you should use a real time range for the start and end values.
        resp = await axios.post(
            `${baseUrl}pitchdetails/record_details/`,
            getParams(
                {
                    linecode: lineData.code,
                    productcode: `testproduct-${new Date().getTime()}`,
                    actual: randomNumber(10, 100),
                    scrap: randomNumber(5, 20),
                    operator_count: randomNumber(0, 10),
                    start: 'now',
                    end: 'now',
                },
                true
            ),
            postConfig
        );
        data = checkResponse(resp);
        log('Recorded Pitch details', data);

        // Let's get the production reporting data for our line
        resp = await axios.get(
            `${baseUrl}reporting/production/daily_summary_data_by_line/`,
            getParams({
                start: apiDateFormat(new Date(new Date().setHours(0, 0, 0, 0))), // Midnight today
                end: apiDateFormat(new Date(new Date().setDate(new Date().getDate() + 1))), // Adding 1 day to date
                linecode: lineData.code,
                show_products: true,
            })
        );
        data = checkResponse(resp);
        log('Retrieved Daily summary for line', data);
    } catch (e) {
        handleErrorResponse(e);
    }
})();

/*
    Utility Functions
*/
function checkResponse({ status, data: respJson }, getData = true, expectResult = false, resultType) {
    // If the HTTP status code is not 200, that means there was some kind of system failure
    if (status !== 200) {
        handleErrorResponse(new Error(`API call system failure, status: ${status}, error: ${resp}`));
    }
    // After verifying the HTTP status code is 200, we need to check the json response and look at the success field.
    // The api call only has succeeded if this field is true.
    if (!respJson.success) {
        handleErrorResponse(new Error(`API call failed, error: ${respJson.error}`));
    }

    // If we want to expect at least one result, we check for that here and error out if not found
    if (expectResult) {
        if (respJson.data.length < 1) {
            handleErrorResponse(`Couldn't find an active ${resultType} to use`);
        }
    }

    return getData ? respJson.data : respJson;
}

function handleErrorResponse(error) {
    // We are just going to output our error message - based on the error we use error.message or string we passed in
    console.error(error);
    process.exit(1);
}

function log(msg, data) {
    console.log(msg);
    if (dbg) {
        console.log(data);
    }
}

function getParams(additionalParams, isPost = false) {
    // Combines universal params and additional params for axios request
    const params = Object.assign({}, universalParams, additionalParams);
    return isPost ? qs.stringify(params) : { params };
}

function minutesToMs(minutes) {
    // Just returns MS value for hours sent in
    return minutes * 60 * 1000;
}

function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function apiDateFormat(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.toLocaleString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    })}`;
}
