"strict mode";
const fs = require("fs");
const EYC = require("./eyc-dbg.js");

(async function() {

    const eyc = await EYC.eyc();
    eyc.ext.fetch = async function(path) {
        return fs.readFileSync("." + path, "utf8");
    };

    let emodule = await eyc.importModule("/" + process.argv[2], {ctx: {privileged: true}});
    let x = new eyc.Object();
    x.extend(emodule.main.klass.prefix);
    x.methods.$$core$Program$init(eyc, x, eyc.nil);
    if (x.methods.$$core$Stage$tick) {
        for (let i = 0; i < 1024; i++) {
            //let a = process.hrtime();
            x.methods.$$core$Stage$tick(eyc, x, eyc.nil);
            /*
            let b = process.hrtime(a);
            console.log(b);
            */
        }
    } else {
        // Should be a Basic program
        x.methods.$$core$Basic$main(eyc, x, eyc.nil);
    }
})();
