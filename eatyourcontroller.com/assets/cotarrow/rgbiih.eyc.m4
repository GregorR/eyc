Copyright (c) 2019 Egor Dorichev and Rami Sabbagh;
license CC-BY-NC-SA-4.0 (
Source: https://github.com/egordorichev/CurseOfTheArrow

This work licensed under a Creative Commons Attribution-NonCommercial-ShareAlike
4.0 International License (https://creativecommons.org/licenses/by-nc-sa/4.0/)

This version was modified by Gregor Richards to use the RGBIIH palette. These
modifications are not creative and therefore do not fall under copyright.
If any copyright is claimed, Gregor Richards also licenses these changes under
CC-BY-NC-SA-4.0.

This file was written by Gregor Richards. It is simply an index, is not
creative, and thus does not fall under copyright. If any copyright is claimed,
Gregor Richards also licenses it under CC-BY-NC-SA-4.0.
);

/* THIS FILE IS GENERATED BY M4. Make sure you modify the m4 file, not the
 * generated file! */
changequote(`[[', `]]')

import /eatyourcontroller.com/basics;

alias core.*;
alias basics.*;

define([[spritesheet]], [[
export sprites $1 $2 {
    default (scale=8$3);

    dirt {
        nw (0, 0);
        n; ne;
        w (0, 1);
        c; e;
        sw (0, 2);
        s; se;
    }

    character {
        idle (0, 9, frames=2);
        run (0, 7, frames=5);
    }
}
]])

spritesheet([[Sprites]], [["rgbiih.png"]], [[]])
spritesheet([[Outlines]], [["rgbiih-outline.png"]],
            [[, multX=10, multY=10]])

export class COTAOutline : Shadow, ObjectSprite {
    override tuple(string, string) staticSprite() {
        ObjectSprite s = this.shadowed : ObjectSprite;
        tuple(string, string) sss = s.staticSprite();
        Console.log(sss[1]);
        return tuple(Outlines : string, sss[1]);
    }
}

export class COTAOutlined : Shadowed {
    mutating this void initCOTAOutlined() {
        COTAOutlined self = this;

        COTAOutline o = new {
            this.shadowed = self;
            this.shadowX = tuple(-0x.2, 0, 0);
            this.shadowY = tuple(-0x.2, 0, 0);
            this.z = self.z - 1;
            this.free = true;
        };
        this.shadows = self.shadows + [o : Shadow];
    }
}

export class DirtWall : MultiWall {
    override tuple(string, string) getSprite(string blocking) {
        if (blocking == "")
            return Sprites.dirt.c;

        string nm = "wall.";
        for (string el in "nsew") {
            if (this.blocking[el])
                nm += el;
        }
        if (nm == "" || nm == "nsew")
            nm = "c";
        return tuple(Sprites : string, nm);
    }
}

export class DirtWallFactory : ObjectContextFactory {
    override mutating this Object get(
        string label, array(string) layer, num x, num y
    ) {
        string blocking = "";
        if (layer[y-1][x] != label)
            blocking += "n";
        if (layer[y+1][x] != label)
            blocking += "s";
        string row = layer[y];
        if (row[x+1] != label)
            blocking += "e";
        if (row[x-1] != label)
            blocking += "w";
        if (blocking == "ns" || blocking == "ew")
            blocking = "nsew";
        return new DirtWall {
            this.initMultiWall(blocking);
        };
    }
}

export class COTAStage : GarmentStage {
    override mutating void initMapping() {
        super();
        this.mapping["."] = new DirtWallFactory;
    }
}
