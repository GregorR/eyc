#!/bin/sh
for i in *.eyc
do
    b="${i%.eyc}"
    if [ -e correct/$b.txt ]
    then
        node ../basic-runner.js $i | diff - correct/$b.txt || echo $b
    else
        node ../basic-runner.js $i > correct/$b.txt
    fi
done
