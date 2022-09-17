"strict mode";
const fs = require("fs");
const EYC = require("./eyc-dbg.js");

(async function() {
    try {
        const eyc = await EYC.eyc();

        eyc.ext.fetch = async function(path) {
            return fs.readFileSync("." + path, "utf8");
        };

        let emodule = await eyc.importModule(eyc.urlAbsolute("/", process.argv[2].replace(/\.eyc$/, "")), {ctx: {privileged: true}});
        let x = new eyc.Object();
        x.extend(emodule.main.klass.prefix);
        x.methods.$$core$Program$init(eyc, x, eyc.nil);
        x.methods.$$core$Basic$main(eyc, x, eyc.nil);
    } catch (ex) {
        console.log(ex.toString());
    }
})();
