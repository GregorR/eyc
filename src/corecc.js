#!/usr/bin/env node
const fs = require("fs");
const isIDC = /[A-Za-z0-9_]/;

const minish = false;

let core = fs.readFileSync("src/core.eyc", "utf8");
let out = "";

if (!minish) {
    // No minification, just write it out
    fs.writeFileSync("src/core.json", JSON.stringify(core), "utf8");
    process.exit(0);
}

// Skip past the license header
core = /^([^@]*)(.*)$/s.exec(core);
out += core[1].trim() + "\n";
core = core[2].trim();

// Get rid of whitespace
let lastIDC = false,
    lastWhite = false;
for (let i = 0; i < core.length; i++) {
    let c = core[i];
    if (/\s/.test(c)) {
        lastWhite = true;
    } else if (isIDC.test(c)) {
        if (lastWhite && lastIDC)
            out += " ";
        lastWhite = false;
        lastIDC = true;
        out += c;
    } else if (c === "/") {
        if (core[i+1] === "/") {
            // Skip 'til the newline
            for (; core[i] !== "\n"; i++);
            lastWhite = true;

        } else if (core[i+1] === "*") {
            // Skip 'til the */
            i += 2;
            for (; core.slice(i, i+2) !== "*/"; i++);
            i++;
            lastWhite = true;

        } else {
            lastWhite = false;
            lastIDC = false;
            out += c;

        }
    } else {
        lastWhite = false;
        lastIDC = false;
        out += c;
    }
}

fs.writeFileSync("src/core.json", JSON.stringify(out), "utf8");
