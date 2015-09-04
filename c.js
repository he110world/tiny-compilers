var MEM_SIZE = 1;//32*1024;
var MAX_STACK_SIZE = 32*1024;
var I = {	// instructions
	NOP: 	0,
	PUSH: 	1,
	POP: 	2,
	STORE: 	3,
	LOAD: 	4,
	ADD: 	5,
	SUB: 	6,
	MUL: 	7,
	DIV: 	8,
	MOD: 	9,
	JMP: 	10,
	JZ: 	11,
	JNZ: 	12,
	CALL: 	13,
	RET: 	14,
	DUP: 	15,
	SWAP: 	16,
	ROT3: 	17,
	LSTORE: 18,	// store local variable
	LLOAD: 	19,	// load local variable
	LT: 	20,
	GT: 	21,
	LE: 	22,
	GE: 	23,
	EQ: 	24,
	NEQ: 	25,
	GSTORE: 26,	// store global variable
	GLOAD: 	27, // load global variable
	HALT: 	100
};

var log_enabled = true;
function log (str) {
	if (log_enabled) {
		console.log(str);
	}
}

function Script (src) {
	this.mem = new Array(MEM_SIZE);
	this.id_table = {};
	this.int_table = {};
	this.bin = [];
	this.asm = [];	// assembly code
	this.glob = [];
	this.func = {};
	this.c = 0;	// token cursor
	this.scope = [];	// '{'=>push	'}'=>pop
	this.started = false;

	this.lex(src);
	this.parse();
}

Script.prototype.lex = function (str) {
	var self = this;

	// skip white & comments
	this.source = str.replace(/\/\/.*$/gm,'').replace(/[ \t\n]/gm,'').replace(/\/\*.*\*\//gm,'');

	// find identifiers
	this.source.replace(/[a-zA-Z][a-zA-Z_0-9]*/g, function(id, offset){
        var retlen = 'return'.length;
        if (id.indexOf('return') === 0 && id.length>retlen) {
            self.id_table[offset + retlen] = id.slice(6);
        } else {
            self.id_table[offset] = id;
        }
	});

	// find numbers
	this.source.replace(/\b\d+/g, function(int, offset){
		self.int_table[offset] = int;
	});

	return str;
};

// id ::= [a-zA-Z_][a-zA-Z_0-9]*	=> String
// int ::= [0-9]+					=> Number
// (){}[]
// +-*/%
// && ||
// >= <= == !=
// =
// > <
// ;
// /*.*/ //.\n
function disasm (bin) {
	for (var asm in I) {
		if (I[asm] == bin) {
			return asm;
		}
	}
	return undefined;
}

Script.prototype.emit = function () {
	for (var i in arguments) {
		this.bin.push(arguments[i]);

		// asm
		if (i == 0) {
			this.asm.push(disasm(arguments[i]));
		} else {
			this.asm.push(arguments[i]);
		}
	}
	return this.bin.length;
};

Script.prototype.hole = function () {
	return this.emit.apply(this, Array.prototype.slice.call(arguments).concat(0)) - 1;
};

Script.prototype.patch = function (inst_offset, inst) {
	this.bin[inst_offset] = inst;

	// asm
	this.asm[inst_offset] = inst;
};

Script.prototype.save = function () {
	return this.c;
};

Script.prototype.load = function (s) {
	this.c = s;
};

Script.prototype.logerr = function (err) {
	this.err = 'Error: [' + (err||'') + ']  '
				+ this.source.slice(Math.max(0,this.c-10), this.c)
				+ '^^^' + this.source[this.c] + '^^^'
				+ this.source.slice(this.c+1, this.c+10);
};

Script.prototype.mustbe = function (tok) {
	if (!this.is(tok)) {
		this.logerr('expect ' + tok);
	}
};

Script.prototype.id = function () {
	var id = this.id_table[this.c];
	if (id) {
		this.c += id.length;
		log(id);
	}
	return id;
};

Script.prototype.int = function () {
	var int = this.int_table[this.c];
	if (int) {
		this.c += int.length;
		log(int);
	}

	return Number(int);
};

Script.prototype.is = function (tok) {
	var is = this.source.slice(this.c, this.c+tok.length) === tok;
	if (is) {
		this.c += tok.length;
		log(tok);
	}
	return is;
};

Script.prototype.address = function (id) {
	var a = {};
	if (id === 'mem') {
		a.store = I.STORE;
		a.load = I.LOAD;
	} else {
		// search scope for declaration
		var addr = -1;
		var lastscope = this.scope.length - 1;
		var i = lastscope;
		for (; i>=0; i--) {
			addr = this.scope[i].indexOf(id);
			if (addr !== -1) {
				break;
			}
		}

		// not declared
		if (addr === -1) {
			i = lastscope;
			addr = this.scope[i].push(id) - 1;
		}

		if (i > 0) {	// local var
			a.store = I.LSTORE;
			a.load = I.LLOAD;

			// get local var address
			for (var j=1; j<i; j++) {
				addr += this.scope[j].length;
			}
		} else {	// global var
			a.store = I.GSTORE;
			a.load = I.GLOAD;
		}
		a.addr = addr;
	}
	return a;
};

Script.prototype.loadvar = function (myvar) {
	if (myvar) {
		this.emit(myvar.load);
	}
	return null;
};

Script.prototype.array_expr = function () {
	log('array_expr');
	var id = this.id();
	var lval = null;
	if (id === 'mem') {	// currently only support the special mem[] array
		this.mustbe('[');
		this.expr();
		this.mustbe(']');
		lval = this.address(id);
	} else {
		this.logerr('currently only mem[] is supported');
	}
	return lval;
};

Script.prototype.func_call_expr = function () {
	log('func_call_expr');
	var id = this.id();
	this.mustbe('(');

	// push args onto stack
	var cnt = 0;
	while (!this.err && !this.is(')')) {
		this.emit(I.PUSH, cnt++);	// addr
		this.expr();				// val
		this.is(',');
	}

	// get function pointer
	var funcptr = this.func[id];
	if (funcptr === undefined) {
		this.logerr('unknown function');
		return null;
	}
	this.emit(I.CALL, funcptr);
	return null;
};

Script.prototype.postfix_expr = function () {
	log('postfix_expr');
	// int, id, id[expr], id(expr-list)
	var s = this.save();
	if (this.is('(')) {
		this.load(s);
		return this.paren_expr();
	}

	var lval = null;
	var id = this.id();
	if (id) {
		if (this.is('[')) {	// array
			this.load(s);
			lval = this.array_expr();
		} else if (this.is('(')) {	// function call
			this.load(s);
			this.func_call_expr();
			lval = null;
		} else {	// global/local var
			lval = this.address(id);
			this.emit(I.PUSH, lval.addr);
		}
	} else {
		var int = this.int();
		if (isNaN(int)) {
			this.logerr('invalid int');
		} else {
			this.emit(I.PUSH, int);
		}
		lval = null;
	}
	return lval;
};

Script.prototype.unary_expr = function () {
	log('unary_expr');
	var sign = 1;
	var islval = true;
	do {
		if (this.is('-')) {
			sign = -sign;
			islval = false;
		} else if (this.is('+')) {
			islval = false;
		} else {
			break;
		}
	} while (!this.err);
	var lval = this.postfix_expr();

	if (!islval) {
		lval = this.loadvar(lval);
	}

	// negative
	if (sign < 0) {
		this.emit(I.PUSH, -1);
		this.emit(I.MUL);
	}
	return lval;
};

Script.prototype.multiplicative_expr = function () {
	log('multiplicative_expr');
	var lval = this.unary_expr();
	do {
		if (this.is('*')) {
			lval = this.loadvar(lval);
			this.loadvar(this.postfix_expr());
			this.emit(I.MUL);
		} else if (this.is('/')) {
			lval = this.loadvar(lval);
			this.loadvar(this.postfix_expr());
			this.emit(I.DIV);
		} else if (this.is('%')) {
			lval = this.loadvar(lval);
			this.loadvar(this.postfix_expr());
			this.emit(I.MOD);
		} else {
			break;
		}
	} while (!this.err);
	return lval;
};

Script.prototype.additive_expr = function () {
	log('additive_expr');
	var lval = this.multiplicative_expr();
	do {
		if (this.is('+')) {
			lval = this.loadvar(lval);
			this.loadvar(this.multiplicative_expr());
			this.emit(I.ADD);
		} else if (this.is('-')) {
			lval = this.loadvar(lval);
			this.loadvar(this.multiplicative_expr());
			this.emit(I.SUB);
		} else {
			break;
		}
	} while (!this.err);
	return lval;
};

Script.prototype.relational_expr = function () {
	log('relational_expr');
	var lval = this.additive_expr();
	do {
		if (this.is('<=')) {
			lval = this.loadvar(lval);
			this.loadvar(this.additive_expr());
			this.emit(I.LE);
		} else if (this.is('>=')) {
			lval = this.loadvar(lval);
			this.loadvar(this.additive_expr());
			this.emit(I.GE);
		} else if (this.is('<')) {
			lval = this.loadvar(lval);
			this.loadvar(this.additive_expr());
			this.emit(I.LT);
		} else if (this.is('>')) {
			lval = this.loadvar(lval);
			this.loadvar(this.additive_expr());
			this.emit(I.GT);
		} else {
			break;
		}
	} while (!this.err);
	return lval;
};

Script.prototype.equality_expr = function () {
	log('equality_expr');
	var lval = this.relational_expr();
	do {
		if (this.is('==')) {
			lval = this.loadvar(lval);
			this.loadvar(this.relational_expr());
			this.emit(I.EQ);
		} else if (this.is('!=')) {
			lval = this.loadvar(lval);
			this.loadvar(this.relational_expr());
			this.emit(I.NEQ);
		} else {
			break;
		}
	} while (!this.err);
	return lval;
};

Script.prototype.expr = function () {
	log('expr');
	var lval = this.equality_expr();
	if (this.is('=')) {
		if (lval) {
			this.expr();
			this.emit(I.DUP);
			this.emit(I.ROT3);	// leave expr val on stack after store
			if (lval.store) {
				this.emit(lval.store);
			}
		} else {
			this.logerr('invalid lvalue');
		}
	} else {
		lval = this.loadvar(lval);
	}
	return lval;
};

Script.prototype.paren_expr = function () {
	log('paren_expr');
	this.mustbe('(');
	var lval = this.expr();
	this.mustbe(')');
	return lval;
};

Script.prototype.statement = function () {
	log('statement');
	if (this.is('if')) {
		this.paren_expr();
		var jmp = this.hole(I.PUSH);
		this.emit(I.JZ);	// if 0, skip over the statement
		this.statement();
		if (this.is('else')) {
			var jmpelse = this.hole(I.PUSH);
			this.emit(I.JMP);
			this.statement();
			this.patch(jmpelse, this.bin.length);
			this.patch(jmp, jmpelse+1);
		} else {
			this.patch(jmp, this.bin.length);
		}
	}
	else if (this.is('do')) {
		var loopbegin = this.bin.length;
		this.statement();
		this.mustbe('while');
		this.paren_expr();
		this.mustbe(';');
		this.emit(I.PUSH, loopbegin);
		var loopend = this.emit(I.JNZ);
	}
	else if (this.is('while')) {
		var loopbegin = this.bin.length;
		this.paren_expr();
		var jmp = this.hole(I.PUSH);
		this.emit(I.JZ);
		this.statement();
		this.emit(I.PUSH, loopbegin);
		var loopend = this.emit(I.JMP);
		this.patch(jmp, this.bin.length);
	}
	else if (this.is('return')) {
		if (!this.is(';')) {
			this.expr();
		} else {
			this.emit(I.PUSH, 0);	// default: return 0
		}
		this.mustbe(';');
		this.emit(I.RET);
	}
	else if (this.is('break')) {	// jump to loop begin
		this.mustbe(';');
	}
	else if (this.is('continue')) {	// jump to loop end
		this.mustbe(';');
	}
	else if (this.is('{')) {
		this.scope.push([]);
		while (!this.err && !this.is('}')) {
			this.statement();
		}
		this.scope.pop();
	}
	else if (this.is(';')) {
	}
	else {
		this.expr();
		this.mustbe(';');
		this.emit(I.POP);
	}
};

/*
Script.prototype.decl_var = function () {
	do {
		var s = this.save();
		var id = this.id();
		var scope = this.scope[this.scope.length-1];
		if (scope[id] !== undefined) {	// already defined => expr
			this.load(s);
			this.expr();
		} else {
			scope[id] = true;	//TODO: store some useful info
			if (this.is('=')) {
				this.expr();
			}
		}
		this.is(',');
	} while (!this.err && !this.is(';'));
};
*/

Script.prototype.decl_func = function () {
	log('decl_func');
	var args = [];
	var funcname = this.id();
	this.func[funcname] = this.bin.length;

	this.mustbe('(');
	while (!this.err && !this.is(')')) {
		args.push(this.id());
		this.is(',');

		// load args from stack
		this.emit(I.LSTORE);
	}
	if (this.is(';')) {	// function declaration
	} else {
		this.mustbe('{');

		// add args to scope
		this.scope.push(args);

        // function body
		while (!this.err && !this.is('}')) {
			this.statement();
		}
		this.scope.pop();
	}
};

Script.prototype.decl_global = function () {
	log('decl');
	var s = this.save();
	var id = this.id();
	if (id && this.is('(')) {
		this.load(s);

		var jmp = this.hole(I.JMP);	// skip over function decl when init global var
		this.decl_func();
		this.patch(jmp, this.bin.length);
	} else {
		this.load(s);
		this.statement();
	}
};

Script.prototype.isdone = function () {
	if (this.err) {
		return true;
	}
	return !this.source[this.c];
};

Script.prototype.parse = function () {
	this.scope.push([]);
	do {
		log('-----------')
		this.decl_global();
	} while (!this.isdone());
	this.scope.pop();

	this.emit(I.HALT);
};

// pc: program counter
Script.prototype.run = function (pc) {
	var inst = this.bin[pc];	// fetch instruction
	var stack = [];
	var callstack = [];
	var varstack = [];
	while (inst) {
		switch (inst) {
			case I.NOP:
			++pc;
			break;

			case I.PUSH:
			stack.push(this.bin[++pc]);
			++pc;
			break;

			case I.POP:
			stack.pop();
			++pc;
			break;

			case I.LOAD:
			var addr = stack.pop();
			stack.push(this.mem[addr]);
			++pc;
			break;

			case I.STORE:
			var val = stack.pop();
			var addr = stack.pop();
			this.mem[addr] = val;
			++pc;
			break;

			case I.GLOAD:
			var addr = stack.pop();
			stack.push(this.glob[addr]);
			++pc;
			break;

			case I.GSTORE:
			var val = stack.pop();
			var addr = stack.pop();
			this.glob[addr] = val;
			++pc;
			break;

			case I.LLOAD:
			var addr = stack.pop();
			stack.push(varstack[varstack.length-1][addr]);
			++pc;
			break;

			case I.LSTORE:
			var val = stack.pop();
			var addr = stack.pop();
			varstack[varstack.length-1][addr] = val;
			++pc;
			break;

            case I.LT:
            var b = stack.pop();
            var a = stack.pop();
            stack.push(a<b ? 1 : 0);
            ++pc;
            break;

            case I.GT:
            var b = stack.pop();
            var a = stack.pop();
            stack.push(a>b ? 1 : 0);
            ++pc;
            break;

            case I.LE:
            var b = stack.pop();
            var a = stack.pop();
            stack.push(a<=b ? 1 : 0);
            ++pc;
            break;

            case I.GE:
            var b = stack.pop();
            var a = stack.pop();
            stack.push(a>=b ? 1 : 0);
            ++pc;
            break;

            case I.NEQ:
            var b = stack.pop();
            var a = stack.pop();
            stack.push(a!=b ? 1 : 0);
            ++pc;
            break;

			case I.ADD:
			var b = stack.pop();
			var a = stack.pop();
			stack.push(a + b);
			++pc;
			break;

			case I.SUB:
			var b = stack.pop();
			var a = stack.pop();
			stack.push(a - b);
			++pc;
			break;

			case I.MUL:
			var b = stack.pop();
			var a = stack.pop();
			stack.push(a * b);
			++pc;
			break;

			case I.DIV:
			var b = stack.pop();
			var a = stack.pop();
			stack.push(a / b);
			++pc;
			break;

			case I.MOD:
			var b = stack.pop();
			var a = stack.pop();
			stack.push(a % b);
			++pc;
			break;

			case I.JMP:
			pc = stack.pop();
			break;

			case I.JZ:
			var zpc = stack.pop();
			var val = stack.pop();
			if (val == 0) {
				pc = zpc;
			} else {
				++pc;
			}
			break;

			case I.JNZ:
			var nzpc = stack.pop();
			var val = stack.pop();
			if (val != 0) {
				pc = nzpc;
			} else {
				++pc;
			}
			break;

			case I.CALL:
			callstack.push(pc+2);
			varstack.push([]);
			pc = this.bin[pc+1];
			break;

			case I.RET:
			pc = callstack.pop();
			varstack.pop();
			break;

			case I.DUP:
			stack.push(stack[stack.length-1]);
			++pc;
			break;

			case I.ROT3:
			var p = stack.length-1;
			var top = stack[p];
			stack[p--] = stack[p];
			stack[p--] = stack[p];
			stack[p] = top;
			++pc;
			break;

			case I.SWAP:
			var p = stack.length-1;
			var top = stack[p];
			stack[p--] = stack[p];
			stack[p] = top;
			++pc;
			break;

			case I.HALT:
			return stack[0];

			default:
			log('invalid instruction:', inst);
			return;
		}

		if (stack.length > MAX_STACK_SIZE) {
			log('stack overflow');
			return;
		}

		inst = this.bin[pc];
	}
};

Script.prototype.exec = function (func) {
	if (this.err) {
		return;
	}

	// init global vars
	if (!this.started) {
		this.run(0);
		this.started = true;
	}

	var pc = this.func[func];
	if (pc) {
		this.run(pc);
	}
};

module.exports = Script;
