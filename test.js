"strict mode";
const fs = require("fs");
const EYC = require("./eyc-dbg.js");

(async function() {

    const eyc = await EYC.eyc();
    eyc.ext.fetch = async function(ignore, path) {
        return fs.readFileSync(path, "utf8");
    };

    let emodule = await eyc.importModule(process.argv[2], {text: fs.readFileSync(process.argv[2], "utf8"), ctx: {privileged: true}});
    let x = new eyc.Object();
    x.extend(emodule.main.klass.prefix);
    x.methods.$$core$Stage$init(eyc, x, eyc.nil);
    for (let i = 0; i < 1024; i++) {
        let a = process.hrtime();
        x.methods.$$core$Stage$tick(eyc, x, eyc.nil);
        let b = process.hrtime(a);
        console.log(b);
    }
})();
