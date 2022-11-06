#!/usr/bin/env node
const w = process.stdout.write.bind(process.stdout);

w(`GIMP Palette
Name: RGBIIH
Columns: 8
#\n`);

let end = "";
for (let v = 0; v < 32; v++) {
    let i = v >> 3;
    let rgb = [
        v & 0x1,
        (v & 0x2) >> 1,
        (v & 0x4) >> 2
    ];

    function outColor(ext, halve) {
        let out = "";
        for (let j = 0; j < 3; j++) {
            let c = rgb[j];
            let v = (c*4 + i) * 255 / 7;
            if (j === halve)
                v /= 2;
            v = ~~v;
            out += (""+v).padStart(3, " ") + " ";
        }
        out += `\t${v}${ext}\n`;
        return out;
    }
    w(outColor(""));

    if (rgb[0] && rgb[1] !== rgb[2]) {
        // Two set, so make a version with the most intense color halved
        if (rgb[1])
            end += outColor(".hg", 1);
        else
            end += outColor(".hr", 0);
    }
}
w(end);

/* RGBII:
w(`GIMP Palette
Name: RGBII
Columns: 8
#\n`);

for (let v = 0; v < 32; v++) {
    let i = v >> 3;
    let rgb = [
        v & 0x1,
        (v & 0x2) >> 1,
        (v & 0x4) >> 2
    ];
    for (let j = 0; j < 3; j++) {
        let c = rgb[j];
        let v = (c*6 + i) * 255 / 9;
        // Yellow -> brown
        if (j === 1 && rgb[0] && rgb[1] && !rgb[2] && (i&1) === 0)
            v /= 2;
        v = ~~v;
        w((""+v).padStart(3, " ") + " ");
    }
    w(`\t${v}\n`);
}
*/
