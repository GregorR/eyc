#!/usr/bin/env node
const license =
`Copyright (c) 2020, 2021 Gregor Richards

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.


This software includes components from multiple sources:
`;
const fs = require("fs");

const browserify = require("browserify");
const through = require("through");

const node_modules = process.cwd() + "/node_modules/";

(async function() {
    let files = [];
    let bify = browserify({bare: true, list: true})
        .add(process.argv[2])
        .plugin("tsify", {files: [], target: "es2017", resolveJsonModule: true})
        .transform("babelify", {global: true, ignore: [/node_modules\/core-js/], extensions: [".js", ".tsx", ".ts"]})
        .transform(function(file) { files.push(file); return through(); }, {global: true})
        .bundle();

    bify.on("error", ()=>{});
    bify.on("data", ()=>{});

    await new Promise((res) => {
        bify.on("end", res);
    });

    // Find the used node modules
    let modules = [], found = new Set();
    files.forEach(file => {
        // Check if this is a node module
        if (file.slice(0, node_modules.length) !== node_modules)
            return;

        file = file.slice(node_modules.length).replace(/\/.*/, "");
        if (!found.has(file)) {
            found.add(file);
            modules.push(file);
        }
    });

    // Get their licenses
    let licenses = license;
    modules.sort().forEach((module) => {
        let foundLicense = null;
        ["LICENSE.mkd", "LICENSE"].forEach((lfile) => {
            try {
                fs.accessSync(`node_modules/${module}/${lfile}`);
                foundLicense = lfile;
            } catch (ex) {}
        });

        if (!foundLicense)
            throw new Error(`Could not find a license file for ${module}!`);

        licenses += "\n\n===\n\n" + module + ":\n\n" + fs.readFileSync(`node_modules/${module}/${foundLicense}`, "utf8").replace(/\r/g, "");
    });

    // Make it into a license header
    licenses = "/*\n * " + licenses.trim().replace(/\n/g, "\n * ") + "\n */\n";
    process.stdout.write(licenses);

})();
