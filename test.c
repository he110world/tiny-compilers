haha(a){
	if(a>10){
		return a;
	}
	return haha(a+1);
}

main(){
	mem[5] = haha(5);
}