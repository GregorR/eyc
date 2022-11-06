// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2022 Gregor Richards
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

/**
 * Convert this hex literal to a value.
 */
export function hexToNum(text: string) {
    if (text.indexOf(".") >= 0) {
        /* Fractional hex literals aren't supported by JS, so
         * do it ourselves */
        let cur = text;
        let val = 0;

        // Fractional part
        // eslint-disable-next-line no-constant-condition
        while (true) {
            val += parseInt(cur.slice(-1), 16);
            val /= 16;
            cur = cur.slice(0, -1);
            if (cur.slice(-1) === ".")
                break;
        }

        // Whole part
        val += parseInt("0" + cur.slice(0, -1), 16);
        return val;

    } else {
        return parseInt(text, 16);
    }
}
