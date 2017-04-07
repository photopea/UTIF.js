

var UTIF = {};

UTIF.toRGBA8 = function(out)
{
	var w = out.width, h = out.height, area = w*h, qarea = area*4, data = out.data;
	var img = new Uint8Array(area*4);
	// 0: WhiteIsZero, 1: BlackIsZero, 2: RGB, 3: Palette color, 4: Transparency mask
	var intp = out["t262"][0], bps = out["t258"][0];
	//console.log("interpretation: ", intp, bps);
	
	if(intp==0) {
		if(bps== 1) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>3])>>(7-(i&7)))&1;  img[qi]=img[qi+1]=img[qi+2]=(1-px)*255;  img[qi+3]=255;    }
		if(bps== 4) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>1])>>(4-4*(i&1)))&15;  img[qi]=img[qi+1]=img[qi+2]=(15-px)*17;  img[qi+3]=255;    }
		if(bps== 8) for(var i=0; i<area; i++) {  var qi=i<<2, px=data[i];  img[qi]=img[qi+1]=img[qi+2]=255-px;  img[qi+3]=255;    }
	}
	if(intp==1) {
		if(bps== 1) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>3])>>(7-  (i&7)))&1;    img[qi]=img[qi+1]=img[qi+2]=(px)*255;  img[qi+3]=255;    }
		if(bps== 2) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>2])>>(6-2*(i&3)))&3;  img[qi]=img[qi+1]=img[qi+2]=(px)* 85;  img[qi+3]=255;    }
		if(bps== 8) for(var i=0; i<area; i++) {  var qi=i<<2, px=data[i];  img[qi]=img[qi+1]=img[qi+2]=    px;  img[qi+3]=255;    }
		if(bps==16) for(var i=0; i<area; i++) {  var qi=i<<2, px=(Math.max(0,data[2*i+1]-5)<<8)|data[2*i];  img[qi]=img[qi+1]=img[qi+2]= Math.min(255,px);  img[qi+3]=255;    } // ladoga.tif
	}	
	if(intp==2) {
		if(bps== 8) {
			if(out["t338"] && out["t338"][0]==1) for(var i=0; i<qarea; i++) img[i] = data[i];
			else for(var i=0; i<area; i++) {  var qi=i<<2, ti=i*3;  img[qi]=data[ti];  img[qi+1]=data[ti+1];  img[qi+2]=data[ti+2];  img[qi+3]=255;    }  }
		else 
			for(var i=0; i<area; i++) {  var qi=i<<2, ti=i*6;  img[qi]=data[ti];  img[qi+1]=data[ti+2];  img[qi+2]=data[ti+4];  img[qi+3]=255;    } 
	}
	if(intp==3) 
	{
		var map = out["t320"];
		for(var i=0; i<area; i++) {  var qi=i<<2, mi=data[i];  img[qi]=(map[mi]>>8);  img[qi+1]=(map[256+mi]>>8);  img[qi+2]=(map[512+mi]>>8);  img[qi+3]=255;    }
	}	
	return img;
}

UTIF.decode = function(buff)
{
	UTIF.decode._decodeG3.allow2D = null;
	var data = new Uint8Array(buff), offset = 0;
	
	var id = UTIF._binBE.readASCII(data, offset, 2);  offset+=2;
	var bin = id=="II" ? UTIF._binLE : UTIF._binBE;
	var num = bin.readUshort(data, offset);  offset+=2
	
	var ifdo = bin.readUint(data, offset);  offset+=4;
	var ifds = [];
	while(true)
	{
		var noff = UTIF.decode._readIFD(bin, data, ifdo, ifds);
		ifdo = bin.readUint(data, noff);
		if(ifdo==0) break;
	}
	
	for(var ii=0; ii<ifds.length; ii++)
	{
		var img = ifds[ii];
		img.width  = img["t256"][0];  delete img["t256"];
		img.height = img["t257"][0];  delete img["t257"];
		
		var cmpr = img["t259"][0];  delete img["t259"];
		if(img["t284"] && img["t284"][0]==2) console.log("PlanarConriguration 2 should not be used!");
		
		var bipp = img["t258"][0] * img["t277"][0];  // bits per pixel
		var soff = img["t273"], bcnt = img["t279"];		if(bcnt==null) bcnt = [(img.height*img.width*bipp)>>3];
		var bytes = new Uint8Array((img.width*img.height*bipp)>>3), bilen = 0;
		
		if(img["t322"]!=null) // tiled
		{
			var tw = img["t322"][0], th = img["t323"][0];
			var tx = Math.floor((img.width  + tw - 1) / tw);
			var ty = Math.floor((img.height + th - 1) / th);
			var tbuff = new Uint8Array(tw*th*bipp>>3);
			for(var y=0; y<ty; y++)
				for(var x=0; x<tx; x++)
				{
					var i = y*tx+x;  GR.set(tbuff, 0);
					UTIF.decode._decompress(img, data, soff[i], bcnt[i], cmpr, tbuff, 0);
					UTIF._copyTile(tbuff, (tw*bipp)>>3, th, bytes, (img.width*bipp)>>3, img.height, (x*tw*bipp)>>3, y*th);
				}
			bilen = bytes.length<<3;
		}
		else	// stripped
		{
			var rps = img["t278"] ? img["t278"][0] : img.height;   rps = Math.min(rps, img.height);
			for(var i=0; i<soff.length; i++)
			{
				UTIF.decode._decompress(img, data, soff[i], bcnt[i], cmpr, bytes, bilen>>3);
				bilen += (img.width * bipp * rps);
			}
			bilen = Math.min(bilen, bytes.length<<3);
		}
		img.data = new Uint8Array(bytes.buffer, 0, bilen>>3);
	}
	return ifds;
}

UTIF.decode._decompress = function(img, data, off, len, cmpr, tgt, toff)
{
	if(false) {}
	else if(cmpr==1) for(var j=0; j<len; j++) tgt[toff+j] = data[off+j];
	else if(cmpr==3) UTIF.decode._decodeG3 (data, off, len, tgt, toff, img.width);
	else if(cmpr==4) UTIF.decode._decodeG4 (data, off, len, tgt, toff, img.width);
	else if(cmpr==5) UTIF.decode._decodeLZW(data, off, tgt, toff);
	else if(cmpr==8) {  var src = new Uint8Array(data.buffer,off,len);  var bin = pako["inflate"](src);  console.log(bin.length); for(var i=0; i<bin.length; i++) tgt[toff+i]=bin[i];  }
	else if(cmpr==32773) UTIF.decode._decodePackBits(data, off, len, tgt, toff); 
	else if(cmpr==32809) UTIF.decode._decodeThunder(data, off, len, tgt, toff);
	else console.log("Unknown compression", cmpr);
	
	if(img["t317"] && img["t317"][0]==2) 
	{	
		var noc = img["t277"], olen = img.width*(img["t278"] ? img["t278"][0] : img.height)*noc;
		if     (noc==1)  for(var j=1; j<olen; j++ )  tgt[toff+j] = (tgt[toff+j-1] + tgt[toff+j])&255; 
		else if(noc==3)  for(var j=3; j<olen; j+=3)  {  
			tgt[toff+j+0] = (tgt[toff+j-3] + tgt[toff+j+0])&255; 
			tgt[toff+j+1] = (tgt[toff+j-2] + tgt[toff+j+1])&255; 
			tgt[toff+j+2] = (tgt[toff+j-1] + tgt[toff+j+2])&255; 
		}
	}
}

UTIF.decode._decodePackBits = function(data, off, len, tgt, toff)
{
	var sa = new Int8Array(data.buffer), ta = new Int8Array(tgt.buffer), lim = off+len;
	while(off<lim) {
		var n = sa[off];  off++;
		if(n>=0  && n<128)    for(var i=0; i< n+1; i++) {  ta[toff]=sa[off];  toff++;  off++;   }
		if(n>=-127 && n<0) {  for(var i=0; i<-n+1; i++) {  ta[toff]=sa[off];  toff++;           }  off++;  }
	}
}
UTIF.decode._decodeThunder = function(data, off, len, tgt, toff)
{
	var d2 = [ 0, 1, 0, -1 ],  d3 = [ 0, 1, 2, 3, 0, -3, -2, -1 ];
	var lim = off+len, qoff = toff*2, px = 0;
	while(off<lim) {
		var b = data[off], msk = (b>>6), n = (b&63);  off++;
		if(msk==3) { px=(n&15);  tgt[qoff>>1] |= (px<<(4*(1-qoff&1)));  qoff++;   }
		if(msk==0) for(var i=0; i<n; i++) {  tgt[qoff>>1] |= (px<<(4*(1-qoff&1)));  qoff++;   }
		if(msk==2) for(var i=0; i<2; i++) {  var d=(n>>(3*(1-i)))&7;  if(d!=4) { px+=d3[d];  tgt[qoff>>1] |= (px<<(4*(1-qoff&1)));  qoff++; }  }
		if(msk==1) for(var i=0; i<3; i++) {  var d=(n>>(2*(2-i)))&3;  if(d!=2) { px+=d2[d];  tgt[qoff>>1] |= (px<<(4*(1-qoff&1)));  qoff++; }  }
	}
}

UTIF.decode._dmap = { "1":0,"011":1,"000011":2,"0000011":3, "010":-1,"000010":-2,"0000010":-3  };
UTIF.decode._lens = ( function() {  
	var addKeys = function(lens, arr, i0, inc) {  for(var i=0; i<arr.length; i++) lens[arr[i]] = i0 + i*inc;  }

	var termW = "00110101,000111,0111,1000,1011,1100,1110,1111,10011,10100,00111,01000,001000,000011,110100,110101," // 15
	+ "101010,101011,0100111,0001100,0001000,0010111,0000011,0000100,0101000,0101011,0010011,0100100,0011000,00000010,00000011,00011010," // 31
	+ "00011011,00010010,00010011,00010100,00010101,00010110,00010111,00101000,00101001,00101010,00101011,00101100,00101101,00000100,00000101,00001010," // 47
	+ "00001011,01010010,01010011,01010100,01010101,00100100,00100101,01011000,01011001,01011010,01011011,01001010,01001011,00110010,00110011,00110100";

	var termB = "0000110111,010,11,10,011,0011,0010,00011,000101,000100,0000100,0000101,0000111,00000100,00000111,000011000," // 15
	+ "0000010111,0000011000,0000001000,00001100111,00001101000,00001101100,00000110111,00000101000,00000010111,00000011000,000011001010,000011001011,000011001100,000011001101,000001101000,000001101001," // 31
	+ "000001101010,000001101011,000011010010,000011010011,000011010100,000011010101,000011010110,000011010111,000001101100,000001101101,000011011010,000011011011,000001010100,000001010101,000001010110,000001010111," // 47
	+ "000001100100,000001100101,000001010010,000001010011,000000100100,000000110111,000000111000,000000100111,000000101000,000001011000,000001011001,000000101011,000000101100,000001011010,000001100110,000001100111";

	var makeW = "11011,10010,010111,0110111,00110110,00110111,01100100,01100101,01101000,01100111,011001100,011001101,011010010,011010011,011010100,011010101,011010110," 
	+ "011010111,011011000,011011001,011011010,011011011,010011000,010011001,010011010,011000,010011011";

	var makeB = "0000001111,000011001000,000011001001,000001011011,000000110011,000000110100,000000110101,0000001101100,0000001101101,0000001001010,0000001001011,0000001001100,"
	+ "0000001001101,0000001110010,0000001110011,0000001110100,0000001110101,0000001110110,0000001110111,0000001010010,0000001010011,0000001010100,0000001010101,0000001011010,"
	+ "0000001011011,0000001100100,0000001100101";

	var makeA = "00000001000,00000001100,00000001101,000000010010,000000010011,000000010100,000000010101,000000010110,000000010111,000000011100,000000011101,000000011110,000000011111";

	termW = termW.split(",");  termB = termB.split(",");  makeW = makeW.split(",");  makeB = makeB.split(",");  makeA = makeA.split(",");

	var lensW = {}, lensB = {};
	addKeys(lensW, termW, 0, 1);  addKeys(lensW, makeW, 64,64);  addKeys(lensW, makeA, 1792,64);
	addKeys(lensB, termB, 0, 1);  addKeys(lensB, makeB, 64,64);  addKeys(lensB, makeA, 1792,64);
	return [lensW, lensB];    } )();

UTIF.decode._decodeG4 = function(data, off, slen, tgt, toff, w)
{
	var U = UTIF.decode, boff=off<<3, len=0, wrd="";
	var line=[], pline=[];  for(var i=0; i<w; i++) pline.push(0);  pline=U._makeDiff(pline);
	var a0=0, a1=0, a2=0, b1=0, b2=0, clr=0;
	var y=0, mode="", toRead=0;
	while((boff>>3)<off+slen)
	{
		b1 = U._findDiff(pline, a0+1, 1-clr), b2 = U._findDiff(pline, b1, clr);	// could be precomputed
		var bit = (data[boff>>3]>>((boff&7)))&1;  boff++;  wrd+=bit;  
		
		if(mode=="H") {
			if(U._lens[clr][wrd]!=null) {  
				var dl=U._lens[clr][wrd];  wrd="";  len+=dl;  
				if(dl<64) {  U._addNtimes(line,len,clr);  a0+=len;  clr=1-clr;  len=0;  toRead--;  if(toRead==0) mode="";  }  
			}
		}
		else {
			if(wrd=="0001")  {  wrd="";  U._addNtimes(line,b2-a0,clr);  a0=b2;   }
			if(wrd=="001" )  {  wrd="";  mode="H";  toRead=2;  }
			if(U._dmap[wrd]!=null) {  a1 = b1+U._dmap[wrd];  U._addNtimes(line, a1-a0, clr);  a0=a1;  wrd="";  clr=1-clr;  }
		}
		if(line.length==w) { 
			U._writeBits(line, tgt, toff*8+y*w);
			clr=0;  y++;  a0=0;
			pline=U._makeDiff(line);  line=[];
		}
	}
}

UTIF.decode._findDiff = function(line, x, clr) {  for(var i=0; i<line.length; i+=2) if(line[i]>=x && line[i+1]==clr)  return line[i];  }
UTIF.decode._makeDiff = function(line) {
	var out = [];  for(var i=0; i<line.length; i++) if(i>0 && line[i-1]!=line[i]) out.push(i, line[i]);
	out.push(line.length,0,line.length,1);  return out;
}
UTIF.decode._decodeG3 = function(data, off, slen, tgt, toff, w)
{
	var U = UTIF.decode, boff=off<<3, len=0, wrd="";
	var line=[], pline=[];  for(var i=0; i<w; i++) line.push(0);
	var a0=0, a1=0, a2=0, b1=0, b2=0, clr=0;
	var y=-1, mode="", toRead=0, is1D=false;
	while((boff>>3)<off+slen)
	{
		b1 = U._findDiff(pline, a0+1, 1-clr), b2 = U._findDiff(pline, b1, clr);	// could be precomputed
		var bit = (data[boff>>3]>>((boff&7)))&1;  boff++;  wrd+=bit;  
		if((boff>>3)>=data.length) throw "e";
		
		if(is1D) {
			if(U._lens[clr][wrd]!=null) { 
				var dl=U._lens[clr][wrd];  wrd="";  len+=dl;  
				if(dl<64) {  U._addNtimes(line,len,clr);  clr=1-clr;  len=0;  }  
			}
		}
		else  {
			if(mode=="H") {
				if(U._lens[clr][wrd]!=null) {  
					var dl=U._lens[clr][wrd];  wrd="";  len+=dl;  
					if(dl<64) {  U._addNtimes(line,len,clr);  a0+=len;  clr=1-clr;  len=0;  toRead--;  if(toRead==0) mode="";  }  
				}
			}
			else {
				if(wrd=="0001")  {  wrd="";  U._addNtimes(line,b2-a0,clr);  a0=b2;   }
				if(wrd=="001" )  {  wrd="";  mode="H";  toRead=2;  }
				if(U._dmap[wrd]!=null) {  a1 = b1+U._dmap[wrd];  U._addNtimes(line, a1-a0, clr);  a0=a1;  wrd="";  clr=1-clr;  }
			}
		}
		if(wrd.endsWith("000000000001")) { 	// needed for some files
			if(y>=0) U._writeBits(line, tgt, toff*8+y*w);
			is1D = ((data[boff>>3]>>((boff&7)))&1)==1;  boff++;
			if(U._decodeG3.allow2D==null) U._decodeG3.allow2D=is1D;
			if(!U._decodeG3.allow2D) {  is1D = true;  boff--;  }
			//console.log("EOL",y, "next 1D:", is1D);
			wrd="";  clr=0;  y++;  a0=0;
			pline=U._makeDiff(line);  line=[];
		}
	}
	if(line.length==w) U._writeBits(line, tgt, toff*8+y*w);
}

UTIF.decode._addNtimes = function(arr, n, val) {  for(var i=0; i<n; i++) arr.push(val);  }

UTIF.decode._writeBits = function(bits, tgt, boff)
{
	for(var i=0; i<bits.length; i++) tgt[(boff+i)>>3] |= (bits[i]<<(7-((boff+i)&7)));
}

UTIF.decode._decodeLZW = function(data, off, tgt, toff)
{
	var tab = [];
	var bits = 9, boff = off<<3;  // offset in bits
		
	var ClearCode = 256, EoiCode = 257;
	var v = 0, Code = 0, OldCode = 0;
	while(true)
	{
		v = (data[boff>>3]<<16) | (data[(boff+8)>>3]<<8) | data[(boff+16)>>3];
		Code = ( v>>(24-(boff&7)-bits) )    &   ((1<<bits)-1);  boff+=bits;
		if(tab.length==0 && Code!=ClearCode) {  console.log("Error in LZW");  return;  }
		
		if(Code==EoiCode) break;
		if(Code==ClearCode) {
			bits=9;  tab = [];  for(var i=0; i<258; i++) tab[i] = [i];  
			v = (data[boff>>3]<<16) | (data[(boff+8)>>3]<<8) | data[(boff+16)>>3];
			Code = ( v>>(24-(boff&7)-bits) )    &   ((1<<bits)-1);  boff+=bits;
			if(Code==EoiCode) break;
			for(var i=0; i<tab[Code].length; i++) tgt[toff+i] = tab[Code][i];
			toff += tab[Code].length;
			OldCode = Code;
		}
		else if(Code<tab.length) {
			for(var i=0; i<tab[Code].length; i++) tgt[toff+i] = tab[Code][i];
			toff += tab[Code].length;
				
			var nit = tab[OldCode].slice(0);  nit.push(tab[Code][0]);
			tab.push(nit);  if(tab.length+1==(1<<bits)) bits++;
				
			OldCode = Code;
		}
		else {
			var OutString = tab[OldCode].slice(0);  OutString.push(OutString[0]);
			for(var i=0; i<OutString.length; i++) tgt[toff+i] = OutString[i];
			toff += OutString.length;
				
			tab.push(OutString);  if(tab.length+1==(1<<bits)) bits++;
			OldCode = Code;
		}
	}
}

UTIF.tags = {254:"NewSubfileType",255:"SubfileType",256:"ImageWidth",257:"ImageLength",258:"BitsPerSample",259:"Compression",262:"PhotometricInterpretation",266:"FillOrder",
			 269:"DocumentName",270:"ImageDescription",271:"Make",272:"Model",273:"StripOffset",274:"Orientation",277:"SamplesPerPixel",278:"RowsPerStrip",
			 279:"StripByteCounts",280:"MinSampleValue",281:"MaxSampleValue",282:"XResolution",283:"YResolution",284:"PlanarConfiguration",286:"XPosition",287:"YPosition",
			 292:"T4Options",296:"ResolutionUnit",297:"PageNumber",305:"Software",306:"DateTime",317:"Predictor",320:"ColorMap",321:"HalftoneHints",322:"TileWidth",
			 323:"TileLength",324:"TileOffset",325:"TileByteCounts",338:"ExtraSample",339:"SampleFormat",
			 512:"JPEGProc",513:"JPEGInterchangeFormat",519:"JPEGQTables",520:"JPEGDCTables",521:"JPEGACTables",
			 529:"YCbCrCoefficients",530:"YCbCrSubSampling",531:"YCbCrPositioning",532:"ReferenceBlackWhite",33432:"Copyright",34377:"Photoshop"};

UTIF.decode._readIFD = function(bin, data, offset, ifds)
{
	var cnt = bin.readUshort(data, offset);  offset+=2;
	var ifd = {};  ifds.push(ifd);
	
	for(var i=0; i<cnt; i++)
	{
		var tag  = bin.readUshort(data, offset);    offset+=2;
		var type = bin.readUshort(data, offset);    offset+=2;
		var num  = bin.readUint  (data, offset);    offset+=4;
		var voff = bin.readUint  (data, offset);    offset+=4;
		
		var arr = ifd["t"+tag] = [];
		if(type==1 || type==7) {  for(var j=0; j<num; j++) arr.push(data[(num<5 ? offset-4 : voff)+j]); }
		if(type==2) {  arr.push( bin.readASCII(data, (num<5 ? offset-4 : voff), num-1) );  }
		if(type==3) {  for(var j=0; j<num; j++) arr.push(bin.readUshort(data, (num<3 ? offset-4 : voff)+2*j));  }
		if(type==4) {  for(var j=0; j<num; j++) arr.push(bin.readUint  (data, (num<2 ? offset-4 : voff)+4*j));  }
		if(type==5) {  for(var j=0; j<num; j++) arr.push(bin.readUint(data, voff+j*8) / bin.readUint(data,voff+j*8+4));  }
		if(arr.length==0) console.log("unknown TIFF tag type: ", type, "num:",num);
		//console.log(tag, type, arr, UTIF.tags[tag]);
	}
	return offset;
}

UTIF._binBE = {
	nextZero   : function(data, o) {  while(data[o]!=0) o++;  return o;  },
	readUshort : function(buff, p) {  return (buff[p]<< 8) |  buff[p+1];  },
	readUint   : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+3];  a[1]=buff[p+2];  a[2]=buff[p+1];  a[3]=buff[p];  return UTIF._binBE.ui32[0];  },
	readASCII  : function(buff, p, l) {  var s = "";   for(var i=0; i<l; i++) s += String.fromCharCode(buff[p+i]);   return s; }
}
UTIF._binBE.ui8  = new Uint8Array(4);
UTIF._binBE.ui32 = new Uint32Array(UTIF._binBE.ui8.buffer);
UTIF._binLE = {
	nextZero   : UTIF._binBE.nextZero,
	readUshort : function(buff, p) {  return (buff[p+1]<< 8) |  buff[p];  },
	readUint   : function(buff, p) {  return (buff[p+3]<<24) | (buff[p+2]<<16) | (buff[p+1]<< 8) | buff[p];  },
	readASCII  : UTIF._binBE.readASCII
}
UTIF._copyTile = function(tb, tw, th, b, w, h, xoff, yoff)
{
	for(var y=0; y<th; y++)
		for(var x=0; x<tw; x++)
		{
			var tx = xoff+x, ty = yoff+y;
			if(tx<w && ty<h) b[ty*w+tx] = tb[y*tw+x];
		}
}