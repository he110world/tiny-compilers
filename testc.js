var Script = require('./c.js');
var fs = require('fs');
fs.readFile('./test.c', function(err, data){
    var c = new Script(data.toString());
    c.exec('main');
    console.log('done');
c
});
//var c = new Script('a=10;b=20;test(a,c){mem[100+a]=b+c+3;d=22;mem[100+b]=d-3;}main(){test(5,6);}');
