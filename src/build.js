#!/usr/bin/env node
// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2020-2022 Gregor Richards
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */

const fs = require("fs");

const babelPlugins = require("@babel/compat-data/plugins");
const browserify = require("browserify");
const browserPackFlat = require("browser-pack-flat");
const semver = require("semver");
const tinyify = require("tinyify");
const tsify = require("tsify");

function advanced(plugins) {
    let ret = Object.create(null);
    for (let p of plugins) {
        if (!(p in babelPlugins)) {
            console.error(`Plugin ${p} does not exist!`);
            process.exit(1);
        }
        for (let b in babelPlugins[p]) {
            let v = babelPlugins[p][b];
            if (b in ret)
                ret[b] = semver.gt(semver.coerce(v), semver.coerce(ret[b])) ? v : ret[b];
            else
                ret[b] = v;
        }
    }

    return Object.keys(ret).map(b => b + ">=" + ret[b]).join(",");
}

let start = null;
let licenseFile = null;
let doTinyify = false;
let debug = false;
let noImplicitAny = false;
let args = process.argv.slice(2);
let babelTargets = null;
for (let ai = 0; ai < args.length; ai++) {
    let arg = args[ai];
    if (arg === "-s" || arg === "--start") {
        start = args[++ai];
    } else if (arg === "-l" || arg === "--license") {
        licenseFile = args[++ai];
    } else if (arg === "-t" || arg === "--tinyify") {
        doTinyify = true;
    } else if (arg === "-g" || arg === "--debug") {
        debug = true;
    } else if (arg === "-n" || arg === "--no-implicit-any") {
        noImplicitAny = true;
    } else if (arg === "-a" || arg === "--advanced-features") {
        babelTargets = advanced(args[++ai].split(","));
    } else if (arg[0] !== "-") {
        if (!start)
            start = arg;
        else if (!licenseFile)
            licenseFile = arg;
        else {
            console.error(`Unexpected argument ${arg}`);
            process.exit(1);
        }
    } else {
        console.error(`Unrecognized argument ${arg}`);
        process.exit(1);
    }
}

if (!start) {
    console.error("Need a start file!");
    process.exit(1);
}

let babelArg = {
    global: true,
    ignore: [/node_modules\/core-js/],
    extensions: [".js", ".tsx", ".ts"]
};
if (babelTargets) {
    babelArg.presets = [["@babel/preset-env", {
        targets: babelTargets,
        useBuiltIns: "usage",
        corejs: 3
    }]];
}

if (licenseFile && !debug)
    process.stdout.write(fs.readFileSync(licenseFile, "utf8"));
browserify({bare: true, standalone: "EYC", debug})
    .add(start)
    .plugin(tsify, {files: [], target: "es2017", resolveJsonModule: true, noImplicitAny})
    .transform("babelify", babelArg)
    .plugin(doTinyify ? tinyify : browserPackFlat)
    .bundle()
    .on("error", error => { console.error(error.toString()); })
    .on("end", () => {
        if (licenseFile && debug)
            process.stdout.write(fs.readFileSync(licenseFile, "utf8"));
    })
    .pipe(process.stdout, {end: false});
