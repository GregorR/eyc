"strict mode";
const fs = require("fs");
const EYC = require("./eyc-dbg.js");

(async function() {
    try {
        const eyc = await EYC.eyc();

        eyc.ext.fetch = async function(ignore, path) {
            return fs.readFileSync(path, "utf8");
        };

        let emodule = await eyc.importModule(process.argv[2], {text: fs.readFileSync(process.argv[2], "utf8"), ctx: {privileged: true}});
        let x = new eyc.Object();
        x.extend(emodule.main.klass.prefix);
        x.methods.$$core$Basic$init(eyc, x, eyc.nil);
        x.methods.$$core$Basic$main(eyc, x, eyc.nil);
    } catch (ex) {
        console.log(ex.toString());
    }
})();
