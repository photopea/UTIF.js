
;(function(){
var UTIF = {};

// Make available for import by `require()`
if (typeof module == "object") {module.exports = UTIF;}
else {self.UTIF = UTIF;}

var pako, JpegDecoder;
if (typeof require == "function") {pako = require("pako"); JpegDecoder = require("jpgjs").JpegDecoder;}
else {pako = self.pako; JpegDecoder = self.JpegDecoder;}

function log() { if (typeof process=="undefined" || process.env.NODE_ENV=="development") console.log.apply(console, arguments);  }

(function(UTIF, pako){

UTIF.encodeImage = function(rgba, w, h, metadata)
{
	var idf = { "t256":[w], "t257":[h], "t258":[8,8,8,8], "t259":[1], "t262":[2], "t273":[1000], // strips offset
				"t277":[4], "t278":[h], /* rows per strip */          "t279":[w*h*4], // strip byte counts
				"t282":[1], "t283":[1], "t284":[1], "t286":[0], "t287":[0], "t296":[1], "t305": ["Photopea (UTIF.js)"], "t338":[1]
		};
	if (metadata) {
		for (var i in metadata) {
			idf[i] = metadata[i];
		}
	}
	var prfx = new Uint8Array(UTIF.encode([idf]));
	var img = new Uint8Array(rgba);
	var data = new Uint8Array(1000+w*h*4);
	for(var i=0; i<prfx.length; i++) data[i] = prfx[i];
	for(var i=0; i<img .length; i++) data[1000+i] = img[i];
	return data.buffer;
}

UTIF.encode = function(ifds)
{
	var data = new Uint8Array(20000), offset = 4, bin = UTIF._binBE;
	data[0]=77;  data[1]=77;  data[3]=42;

	var ifdo = 8;
	bin.writeUint(data, offset, ifdo);  offset+=4;
	for(var i=0; i<ifds.length; i++)
	{
		var noffs = UTIF._writeIFD(bin, data, ifdo, ifds[i]);
		ifdo = noffs[1];
		if(i<ifds.length-1) bin.writeUint(data, noffs[0], ifdo);
	}
	return data.slice(0, ifdo).buffer;
}
//UTIF.encode._writeIFD

UTIF.decode = function(buff)
{
	UTIF.decode._decodeG3.allow2D = null;
	var data = new Uint8Array(buff), offset = 0;

	var id = UTIF._binBE.readASCII(data, offset, 2);  offset+=2;
	var bin = id=="II" ? UTIF._binLE : UTIF._binBE;
	var num = bin.readUshort(data, offset);  offset+=2;

	var ifdo = bin.readUint(data, offset);  offset+=4;
	var ifds = [];
	while(true)
	{
		var noff = UTIF._readIFD(bin, data, ifdo, ifds);
		//var ifd = ifds[ifds.length-1];   if(ifd["t34665"]) {  ifd.exifIFD = [];  UTIF._readIFD(bin, data, ifd["t34665"][0], ifd.exifIFD);  }
		ifdo = bin.readUint(data, noff);
		if(ifdo==0) break;
	}
	return ifds;
}


UTIF.decodeImages = function(buff, ifds)
{
	var data = new Uint8Array(buff);
	var id = UTIF._binBE.readASCII(data, 0, 2);
	
	for(var ii=0; ii<ifds.length; ii++)
	{
		var img = ifds[ii];
		if(img["t256"]==null) continue;	// EXIF files don't have TIFF tags
		img.isLE = id=="II";
		img.width  = img["t256"][0];  //delete img["t256"];
		img.height = img["t257"][0];  //delete img["t257"];

		var cmpr   = img["t259"][0];  //delete img["t259"];
		var fo = img["t266"] ? img["t266"][0] : 1;  //delete img["t266"];
		if(img["t284"] && img["t284"][0]==2) log("PlanarConriguration 2 should not be used!");

		var bipp = (img["t258"]?Math.min(32,img["t258"][0]):1) * (img["t277"]?img["t277"][0]:1);  // bits per pixel
		var soff = img["t273"];  if(soff==null) soff = img["t324"];
		var bcnt = img["t279"];  if(cmpr==1 && soff.length==1) bcnt = [Math.ceil(img.height*img.width*bipp/8)|0];  if(bcnt==null) bcnt = img["t325"];
		var bytes = new Uint8Array(Math.ceil(img.width*img.height*bipp/8)|0), bilen = 0;

		if(img["t322"]!=null) // tiled
		{
			var tw = img["t322"][0], th = img["t323"][0];
			var tx = Math.floor((img.width  + tw - 1) / tw);
			var ty = Math.floor((img.height + th - 1) / th);
			var tbuff = new Uint8Array(Math.ceil(tw*th*bipp/8)|0);
			for(var y=0; y<ty; y++)
				for(var x=0; x<tx; x++)
				{
					var i = y*tx+x;  for(var j=0; j<tbuff.length; j++) tbuff[j]=0;
					UTIF.decode._decompress(img, data, soff[i], bcnt[i], cmpr, tbuff, 0, fo);
					UTIF._copyTile(tbuff, Math.ceil(tw*bipp/8)|0, th, bytes, Math.ceil(img.width*bipp/8)|0, img.height, Math.ceil(x*tw*bipp/8)|0, y*th);
				}
			bilen = bytes.length*8;
		}
		else	// stripped
		{
			var rps = img["t278"] ? img["t278"][0] : img.height;   rps = Math.min(rps, img.height);
			for(var i=0; i<soff.length; i++)
			{
				UTIF.decode._decompress(img, data, soff[i], bcnt[i], cmpr, bytes, Math.ceil(bilen/8)|0, fo);
				bilen += (img.width * bipp * rps);
			}
			bilen = Math.min(bilen, bytes.length*8);
		}
		img.data = new Uint8Array(bytes.buffer, 0, Math.ceil(bilen/8)|0);
	}
}

UTIF.decode._decompress = function(img, data, off, len, cmpr, tgt, toff, fo)  // fill order
{
	if(false) {}
	else if(cmpr==1) for(var j=0; j<len; j++) tgt[toff+j] = data[off+j];
	else if(cmpr==3) UTIF.decode._decodeG3 (data, off, len, tgt, toff, img.width, fo);
	else if(cmpr==4) UTIF.decode._decodeG4 (data, off, len, tgt, toff, img.width, fo);
	else if(cmpr==5) UTIF.decode._decodeLZW(data, off, tgt, toff);
	else if(cmpr==7) UTIF.decode._decodeNewJPEG(img, data, off, len, tgt, toff);
	else if(cmpr==8) {  var src = new Uint8Array(data.buffer,off,len);  var bin = pako["inflate"](src);  for(var i=0; i<bin.length; i++) tgt[toff+i]=bin[i];  }
	else if(cmpr==32773) UTIF.decode._decodePackBits(data, off, len, tgt, toff);
	else if(cmpr==32809) UTIF.decode._decodeThunder (data, off, len, tgt, toff);
	//else if(cmpr==34713) UTIF.decode._decodeNikon   (data, off, len, tgt, toff);
	else log("Unknown compression", cmpr);

	if(img["t317"] && img["t317"][0]==2)
	{
		var noc = (img["t277"]?img["t277"][0]:1), h = (img["t278"] ? img["t278"][0] : img.height), bpr = img.width*noc;
		//console.log(noc);
		for(var y=0; y<h; y++) {
			var ntoff = toff+y*bpr;
			if(noc==3) for(var j=  3; j<bpr; j+=3) {
				tgt[ntoff+j  ] = (tgt[ntoff+j  ] + tgt[ntoff+j-3])&255;
				tgt[ntoff+j+1] = (tgt[ntoff+j+1] + tgt[ntoff+j-2])&255;
				tgt[ntoff+j+2] = (tgt[ntoff+j+2] + tgt[ntoff+j-1])&255;
			}
			else       for(var j=noc; j<bpr; j++) tgt[ntoff+j] = (tgt[ntoff+j] + tgt[ntoff+j-noc])&255;
		}
	}
}

UTIF.decode._decodeNikon = function(data, off, len, tgt, toff)
{
	var nikon_tree = [
    [ 0,1,5,1,1,1,1,1,1,2,0,0,0,0,0,0,	/* 12-bit lossy */
      5,4,3,6,2,7,1,0,8,9,11,10,12 ],
    [ 0,1,5,1,1,1,1,1,1,2,0,0,0,0,0,0,	/* 12-bit lossy after split */
      0x39,0x5a,0x38,0x27,0x16,5,4,3,2,1,0,11,12,12 ],
    [ 0,1,4,2,3,1,2,0,0,0,0,0,0,0,0,0,  /* 12-bit lossless */
      5,4,6,3,7,2,8,1,9,0,10,11,12 ],
    [ 0,1,4,3,1,1,1,1,1,2,0,0,0,0,0,0,	/* 14-bit lossy */
      5,6,4,7,8,3,9,2,1,0,10,11,12,13,14 ],
    [ 0,1,5,1,1,1,1,1,1,1,2,0,0,0,0,0,	/* 14-bit lossy after split */
      8,0x5c,0x4b,0x3a,0x29,7,6,5,4,3,2,1,0,13,14 ],
    [ 0,1,4,2,2,3,1,2,0,0,0,0,0,0,0,0,	/* 14-bit lossless */
      7,6,8,5,9,4,10,3,11,12,2,0,1,13,14 ] ];
	  
	//struct decode *dindex;
	var ver0, ver1, vpred, hpred, csize;
	var i, min, max, step=0, huff=0, split=0, row, col, len, shl, diff;
	
	console.log(data.slice(off,off+100));
	ver0 = data[off];  off++;
	ver1 = data[off];  off++;
	console.log(ver0.toString(16), ver1.toString(16), len);
}

UTIF.decode._decodeNewJPEG = function(img, data, off, len, tgt, toff)
{
	//throw "e";
	//console.log("_decodeNewJPEG", off, toff);
    if (typeof JpegDecoder=="undefined") { log("jpg.js required for handling JPEG compressed images");  return;  }

    var tables = img["t347"], tlen = tables ? tables.length : 0, buff = new Uint8Array(tlen + len);

    if (tables) {
		var SOI = 216, EOI = 217, boff = 0;
        for (var i=0; i<(tlen-1); i++) {
            // Skip EOI marker from JPEGTables
            if (tables[i]==255 && tables[i+1]==EOI) break;
            buff[boff++] = tables[i];
        }

        // Skip SOI marker from data
        var byte1 = data[off], byte2 = data[off + 1];
        if (byte1!=255 || byte2!=SOI) {
            buff[boff++] = byte1;
            buff[boff++] = byte2;
        }
        for (var i=2; i<len; i++) buff[boff++] = data[off+i];
    }
	else
        for (var i=0; i<len; i++) buff[i] = data[off+i];

	if(img["t262"]==32803) {	// lossless JPEG (used in DNG files) is not available in JpegDecoder. 
		var bps = img["t258"][0], dcdr = new LosslessJpegDecoder();
		var out = dcdr.decode(buff), olen=out.length;
		
		if(false) {}
		else if(bps==16) for(var i=0; i<olen; i++) {  tgt[toff++] = (out[i]&255);  tgt[toff++] = (out[i]>>>8);  }
		else if(bps==12) {
			for(var i=0; i<olen; i+=2) {  tgt[toff++] = (out[i]>>>4);  tgt[toff++] = ((out[i]<<4)|(out[i+1]>>>8))&255;  tgt[toff++] = out[i+1]&255;  }
		}
		else throw "unsupported bit depth "+bps;
	}
	else {
		var parser = new JpegDecoder();  parser.parse(buff);
		var decoded = parser.getData(parser.width, parser.height);
		for (var i=0; i<decoded.length; i++) tgt[toff + i] = decoded[i];
	}
	
	//console.log(out);
	//throw "e";
	
	//throw "e";

    // PhotometricInterpretation is 6 (YCbCr) for JPEG, but after decoding we populate data in
    // RGB format, so updating the tag value
    if(img["t262"][0] == 6)  img["t262"][0] = 2;
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
		var b = data[off], msk = (b>>>6), n = (b&63);  off++;
		if(msk==3) { px=(n&15);  tgt[qoff>>>1] |= (px<<(4*(1-qoff&1)));  qoff++;   }
		if(msk==0) for(var i=0; i<n; i++) {  tgt[qoff>>>1] |= (px<<(4*(1-qoff&1)));  qoff++;   }
		if(msk==2) for(var i=0; i<2; i++) {  var d=(n>>>(3*(1-i)))&7;  if(d!=4) { px+=d3[d];  tgt[qoff>>>1] |= (px<<(4*(1-qoff&1)));  qoff++; }  }
		if(msk==1) for(var i=0; i<3; i++) {  var d=(n>>>(2*(2-i)))&3;  if(d!=2) { px+=d2[d];  tgt[qoff>>>1] |= (px<<(4*(1-qoff&1)));  qoff++; }  }
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

UTIF.decode._decodeG4 = function(data, off, slen, tgt, toff, w, fo)
{
	var U = UTIF.decode, boff=off<<3, len=0, wrd="";	// previous starts with 1
	var line=[], pline=[];  for(var i=0; i<w; i++) pline.push(0);  pline=U._makeDiff(pline);
	var a0=0, a1=0, a2=0, b1=0, b2=0, clr=0;
	var y=0, mode="", toRead=0;

	while((boff>>>3)<off+slen)
	{
		b1 = U._findDiff(pline, a0+(a0==0?0:1), 1-clr), b2 = U._findDiff(pline, b1, clr);	// could be precomputed
		var bit =0;
		if(fo==1) bit = (data[boff>>>3]>>>(7-(boff&7)))&1;
		if(fo==2) bit = (data[boff>>>3]>>>(  (boff&7)))&1;
		boff++;  wrd+=bit;
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
		if(line.length==w && mode=="") {
			U._writeBits(line, tgt, toff*8+y*w);
			clr=0;  y++;  a0=0;
			pline=U._makeDiff(line);  line=[];
		}
		//if(wrd.length>150) {  log(wrd);  break;  throw "e";  }
	}
}

UTIF.decode._findDiff = function(line, x, clr) {  for(var i=0; i<line.length; i+=2) if(line[i]>=x && line[i+1]==clr)  return line[i];  }
UTIF.decode._makeDiff = function(line) {
	var out = [];  if(line[0]==1) out.push(0,1);
	for(var i=1; i<line.length; i++) if(line[i-1]!=line[i]) out.push(i, line[i]);
	out.push(line.length,0,line.length,1);  return out;
}
UTIF.decode._decodeG3 = function(data, off, slen, tgt, toff, w, fo)
{
	var U = UTIF.decode, boff=off<<3, len=0, wrd="";
	var line=[], pline=[];  for(var i=0; i<w; i++) line.push(0);
	var a0=0, a1=0, a2=0, b1=0, b2=0, clr=0;
	var y=-1, mode="", toRead=0, is1D=false;
	while((boff>>>3)<off+slen)
	{
		b1 = U._findDiff(pline, a0+(a0==0?0:1), 1-clr), b2 = U._findDiff(pline, b1, clr);	// could be precomputed
		var bit =0;
		if(fo==1) bit = (data[boff>>>3]>>>(7-(boff&7)))&1;
		if(fo==2) bit = (data[boff>>>3]>>>(  (boff&7)))&1;
		boff++;  wrd+=bit;

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
			if(fo==1) is1D = ((data[boff>>>3]>>>(7-(boff&7)))&1)==1;
			if(fo==2) is1D = ((data[boff>>>3]>>>(  (boff&7)))&1)==1;
			boff++;
			if(U._decodeG3.allow2D==null) U._decodeG3.allow2D=is1D;
			if(!U._decodeG3.allow2D) {  is1D = true;  boff--;  }
			//log("EOL",y, "next 1D:", is1D);
			wrd="";  clr=0;  y++;  a0=0;
			pline=U._makeDiff(line);  line=[];
		}
	}
	if(line.length==w) U._writeBits(line, tgt, toff*8+y*w);
}

UTIF.decode._addNtimes = function(arr, n, val) {  for(var i=0; i<n; i++) arr.push(val);  }

UTIF.decode._writeBits = function(bits, tgt, boff)
{
	for(var i=0; i<bits.length; i++) tgt[(boff+i)>>>3] |= (bits[i]<<(7-((boff+i)&7)));
}

UTIF.decode._decodeLZW = function(data, off, tgt, toff)
{
	if(UTIF.decode._lzwTab==null) {
		var tb=new Uint32Array(0xffff), tn=new Uint16Array(0xffff), chr=new Uint8Array(2e6);  
		for(var i=0; i<256; i++) { chr[i<<2]=i;  tb[i]=i<<2;  tn[i]=1;  }
		UTIF.decode._lzwTab = [tb,tn,chr];
	}
	var copy = UTIF.decode._copyData;
	var tab = UTIF.decode._lzwTab[0], tln=UTIF.decode._lzwTab[1], chr=UTIF.decode._lzwTab[2], totl = 258, chrl = 258<<2;
	var bits = 9, boff = off<<3;  // offset in bits

	var ClearCode = 256, EoiCode = 257;
	var v = 0, Code = 0, OldCode = 0;
	while(true) {
		v = (data[boff>>>3]<<16) | (data[(boff+8)>>>3]<<8) | data[(boff+16)>>>3];
		Code = ( v>>(24-(boff&7)-bits) )    &   ((1<<bits)-1);  boff+=bits;
		
		if(Code==EoiCode) break;
		if(Code==ClearCode) {
			bits=9;  totl = 258;  chrl = 258<<2;
			
			v = (data[boff>>>3]<<16) | (data[(boff+8)>>>3]<<8) | data[(boff+16)>>>3];
			Code = ( v>>(24-(boff&7)-bits) )    &   ((1<<bits)-1);  boff+=bits;
			if(Code==EoiCode) break;
			tgt[toff]=Code;  toff++;
		}
		else if(Code<totl) {
			var cd = tab[Code], cl = tln[Code];
			copy(chr,cd,tgt,toff,cl);  toff += cl;

			if(OldCode>=totl) {  tab[totl] = chrl;  chr[tab[totl]] = cd[0];  tln[totl]=1;  chrl=(chrl+1+3)&~0x03;  totl++;  }
			else {
				tab[totl] = chrl;
				var nit = tab[OldCode], nil = tln[OldCode];
				copy(chr,nit,chr,chrl,nil);
				chr[chrl+nil]=chr[cd];  nil++;
				tln[totl]=nil;  totl++;
				
				chrl=(chrl+nil+3)&~0x03;
			}
			if(totl+1==(1<<bits)) bits++;
		}
		else {
			if(OldCode>=totl) {  tab[totl] = chrl;  tln[totl]=0;  totl++;  }
			else {
				tab[totl] = chrl;
				var nit = tab[OldCode], nil = tln[OldCode];
				copy(chr,nit,chr,chrl,nil);
				chr[chrl+nil]=chr[chrl];  nil++;
				tln[totl]=nil;  totl++;
				
				copy(chr,chrl,tgt,toff,nil);  toff += nil;  
				chrl=(chrl+nil+3)&~0x03;
			}
			if(totl+1==(1<<bits)) bits++;
		}
		OldCode = Code;
	}
}
UTIF.decode._copyData = function(s,so,t,to,l) {  for(var i=0;i<l;i+=4) {  t[to+i]=s[so+i];  t[to+i+1]=s[so+i+1];  t[to+i+2]=s[so+i+2];  t[to+i+3]=s[so+i+3];  }  }

UTIF.tags = {254:"NewSubfileType",255:"SubfileType",256:"ImageWidth",257:"ImageLength",258:"BitsPerSample",259:"Compression",262:"PhotometricInterpretation",266:"FillOrder",
			 269:"DocumentName",270:"ImageDescription",271:"Make",272:"Model",273:"StripOffset",274:"Orientation",277:"SamplesPerPixel",278:"RowsPerStrip",
			 279:"StripByteCounts",280:"MinSampleValue",281:"MaxSampleValue",282:"XResolution",283:"YResolution",284:"PlanarConfiguration",285:"PageName",
			 286:"XPosition",287:"YPosition",
			 292:"T4Options",296:"ResolutionUnit",297:"PageNumber",305:"Software",306:"DateTime",315:"Artist",316:"HostComputer",317:"Predictor",320:"ColorMap",
			 321:"HalftoneHints",322:"TileWidth",
			 323:"TileLength",324:"TileOffset",325:"TileByteCounts",330:"SubIFDs",336:"DotRange",338:"ExtraSample",339:"SampleFormat", 347:"JPEGTables",
			 512:"JPEGProc",513:"JPEGInterchangeFormat",514:"JPEGInterchangeFormatLength",519:"JPEGQTables",520:"JPEGDCTables",521:"JPEGACTables",
			 529:"YCbCrCoefficients",530:"YCbCrSubSampling",531:"YCbCrPositioning",532:"ReferenceBlackWhite",700:"XMP",
			 33421:"CFARepeatPatternDim",33422:"CFAPattern",33432:"Copyright",33434:"ExposureTime",33437:"FNumber",33723:"IPTC/NAA",34377:"Photoshop",
			 34665:"ExifIFD",34850:"ExposureProgram",34853:"GPSInfo",34855:"ISOSpeedRatings",34858:"TimeZoneOffset",34859:"SelfTimeMode",
			 36867:"DateTimeOriginal",36868:"DateTimeDigitized",
			 37377:"ShutterSpeedValue",37378:"ApertureValue",37380:"ExposureBiasValue",37383:"MeteringMode",37385:"Flash",37386:"FocalLength",
			 37390:"FocalPlaneXResolution",37391:"FocalPlaneYResolution",37392:"FocalPlaneResolutionUnit",37393:"ImageNumber",37398:"TIFF/EPStandardID",37399:"SensingMethod",
			 37500:"MakerNote",37510:"UserComment",
			 40092:"XPComment",40094:"XPKeywords",
			 40961:"ColorSpace",40962:"PixelXDimension",40963:"PixelXDimension",41486:"FocalPlaneXResolution",41487:"FocalPlaneYResolution",41488:"FocalPlaneResolutionUnit",
			 41985:"CustomRendered",41986:"ExposureMode",41987:"WhiteBalance",41990:"SceneCaptureType",
			 50706:"DNGVersion",50707:"DNGBackwardVersion",50708:"UniqueCameraModel",50709:"LocalizedCameraModel",50710:"CFAPlaneColor",
			 50711:"CFALayout",50712:"LinearizationTable",50713:"BlackLevelRepeatDim",50714:"BlackLevel",50716:"BlackLevelDeltaV",50717:"WhiteLevel",
			 50718:"DefaultScale",50719:"DefaultCropOrigin",
			 50720:"DefaultCropSize",50733:"BayerGreenSplit",50738:"AntiAliasStrength",
			 50721:"ColorMatrix1",50722:"ColorMatrix2",50723:"CameraCalibration1",50724:"CameraCalibration2",50727:"AnalogBalance",50728:"AsShotNeutral",
			 50730:"BaselineExposure",50731:"BaselineNoise",50732:"BaselineSharpness",50734:"LinearResponseLimit",50735:"CameraSerialNumber",50736:"LensInfo",50739:"ShadowScale",
			 50740:"DNGPrivateData",50741:"MakerNoteSafety",50778:"CalibrationIlluminant1",50779:"CalibrationIlluminant2",50780:"BestQualityScale",
			 50781:"RawDataUniqueID",50827:"OriginalRawFileName",50829:"ActiveArea",50830:"MaskedAreas",50931:"CameraCalibrationSignature",50932:"ProfileCalibrationSignature",
			 50935:"NoiseReductionApplied",50936:"ProfileName",50937:"ProfileHueSatMapDims",50938:"ProfileHueSatMapData1",50939:"ProfileHueSatMapData2",
			 50940:"ProfileToneCurve",50941:"ProfileEmbedPolicy",50942:"ProfileCopyright",
			 50964:"ForwardMatrix1",50965:"ForwardMatrix2",50966:"PreviewApplicationName",50967:"PreviewApplicationVersion",50969:"PreviewSettingsDigest",
			 50970:"PreviewColorSpace",50971:"PreviewDateTime",50972:"RawImageDigest",
			 51008:"OpcodeList1",51009:"OpcodeList2",51022:"OpcodeList3",51041:"NoiseProfile",51089:"OriginalDefaultFinalSize",
			 51090:"OriginalBestQualityFinalSize",51091:"OriginalDefaultCropSize",51125:"DefaultUserCrop"};

UTIF.ttypes = {  256:3,257:3,258:3,   259:3, 262:3,  273:4,  274:3, 277:3,278:4,279:4, 282:5, 283:5, 284:3, 286:5,287:5, 296:3, 305:2, 306:2, 338:3, 513:4, 514:4, 34665:4  };

UTIF._readIFD = function(bin, data, offset, ifds)
{
	var cnt = bin.readUshort(data, offset);  offset+=2;
	var ifd = {};  ifds.push(ifd);

	//console.log(">>>----------------");
	for(var i=0; i<cnt; i++) {
		var tag  = bin.readUshort(data, offset);    offset+=2;
		var type = bin.readUshort(data, offset);    offset+=2;
		var num  = bin.readUint  (data, offset);    offset+=4;
		var voff = bin.readUint  (data, offset);    offset+=4;

		var arr = [];
		ifd["t"+tag] = arr;
		//ifd["t"+tag+"-"+UTIF.tags[tag]] = arr;
		if(type== 1 || type==7) {  for(var j=0; j<num; j++) arr.push(data[(num<5 ? offset-4 : voff)+j]); }
		if(type== 2) {  arr.push( bin.readASCII(data, (num<5 ? offset-4 : voff), num-1) );  }
		if(type== 3) {  for(var j=0; j<num; j++) arr.push(bin.readUshort(data, (num<3 ? offset-4 : voff)+2*j));  }
		if(type== 4) {  for(var j=0; j<num; j++) arr.push(bin.readUint  (data, (num<2 ? offset-4 : voff)+4*j));  }
		if(type== 5) {  for(var j=0; j<num; j++) arr.push(bin.readUint  (data, voff+j*8) / bin.readUint(data,voff+j*8+4));  }
		if(type== 8) {  for(var j=0; j<num; j++) arr.push(bin.readShort (data, (num<3 ? offset-4 : voff)+2*j));  }
		if(type== 9) {  for(var j=0; j<num; j++) arr.push(bin.readInt   (data, (num<2 ? offset-4 : voff)+4*j));  }
		if(type==10) {  for(var j=0; j<num; j++) arr.push(bin.readInt   (data, voff+j*8) / bin.readInt (data,voff+j*8+4));  }
		if(type==11) {  for(var j=0; j<num; j++) arr.push(bin.readFloat (data, voff+j*4));  }
		if(type==12) {  for(var j=0; j<num; j++) arr.push(bin.readDouble(data, voff+j*8));  }
		if(num!=0 && arr.length==0) log("unknown TIFF tag type: ", type, "num:",num);
		//log(tag, type, UTIF.tags[tag], arr);
		if(tag==  330) for(var j=0; j<num; j++) UTIF._readIFD(bin, data, arr[j], ifds);
		//if(tag==34665) UTIF._readIFD(bin, data, arr[0], ifds);
	}
	//console.log("<<<---------------");
	return offset;
}
UTIF._writeIFD = function(bin, data, offset, ifd)
{
	var keys = Object.keys(ifd);
	bin.writeUshort(data, offset, keys.length);  offset+=2;

	var eoff = offset + keys.length*12 + 4;

	for(var ki=0; ki<keys.length; ki++) {
		var key = keys[ki];
		var tag = parseInt(key.slice(1)), type = UTIF.ttypes[tag];  if(type==null) throw "unknown type of tag: "+tag;
		var val = ifd[key];  if(type==2) val=val[0]+"\u0000";  var num = val.length;
		bin.writeUshort(data, offset, tag );  offset+=2;
		bin.writeUshort(data, offset, type);  offset+=2;
		bin.writeUint  (data, offset, num );  offset+=4;

		var dlen = [-1, 1, 1, 2, 4, 8, 0, 0, 0, 0, 0, 0, 8][type] * num;
		var toff = offset;
		if(dlen>4) {  bin.writeUint(data, offset, eoff);  toff=eoff;  }

		if(type==2) {  bin.writeASCII(data, toff, val);   }
		if(type==3) {  for(var i=0; i<num; i++) bin.writeUshort(data, toff+2*i, val[i]);    }
		if(type==4) {  for(var i=0; i<num; i++) bin.writeUint  (data, toff+4*i, val[i]);    }
		if(type==5) {  for(var i=0; i<num; i++) {  bin.writeUint(data, toff+8*i, Math.round(val[i]*10000));  bin.writeUint(data, toff+8*i+4, 10000);  }   }
		if (type == 12) {  for (var i = 0; i < num; i++) bin.writeDouble(data, toff + 8 * i, val[i]); }

		if(dlen>4) {  dlen += (dlen&1);  eoff += dlen;  }
		offset += 4;
	}
	return [offset, eoff];
}

UTIF.toRGBA8 = function(out)
{
	var w = out.width, h = out.height, area = w*h, qarea = area*4, data = out.data;
	var img = new Uint8Array(area*4);
	// 0: WhiteIsZero, 1: BlackIsZero, 2: RGB, 3: Palette color, 4: Transparency mask, 5: CMYK
	var intp = out["t262"][0], bps = (out["t258"]?Math.min(32,out["t258"][0]):1), isLE = out.isLE ? 1 : 0;
	//log("interpretation: ", intp, "bps", bps, out);
	if(false) {}
	else if(intp==0) {
		if(bps== 1) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>3])>>(7-  (i&7)))& 1;  img[qi]=img[qi+1]=img[qi+2]=( 1-px)*255;  img[qi+3]=255;    }
		if(bps== 4) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>1])>>(4-4*(i&1)))&15;  img[qi]=img[qi+1]=img[qi+2]=(15-px)* 17;  img[qi+3]=255;    }
		if(bps== 8) for(var i=0; i<area; i++) {  var qi=i<<2, px=data[i];  img[qi]=img[qi+1]=img[qi+2]=255-px;  img[qi+3]=255;    }
	}
	else if(intp==1) {
		if(bps== 1) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>3])>>(7-  (i&7)))&1;   img[qi]=img[qi+1]=img[qi+2]=(px)*255;  img[qi+3]=255;    }
		if(bps== 2) for(var i=0; i<area; i++) {  var qi=i<<2, px=((data[i>>2])>>(6-2*(i&3)))&3;   img[qi]=img[qi+1]=img[qi+2]=(px)* 85;  img[qi+3]=255;    }
		if(bps== 8) for(var i=0; i<area; i++) {  var qi=i<<2, px=data[i];  img[qi]=img[qi+1]=img[qi+2]=    px;  img[qi+3]=255;    }
		if(bps==16) for(var i=0; i<area; i++) {  var qi=i<<2, px=data[2*i+isLE];  img[qi]=img[qi+1]=img[qi+2]= Math.min(255,px);  img[qi+3]=255;    } // ladoga.tif
	}
	else if(intp==2) {
		if(bps== 8) {	// this needs to be simplified ... how many channels are there???
			if(out["t338"]) {
				 if(out["t338"][0]>0) for(var i=0; i<qarea; i++) img[i] = data[i];	// sometimes t338 is 1 or 2 in case of Alpha
				 else  for(var i=0; i<qarea; i+=4) {  img[i] = data[i];  img[i+1] = data[i+1];  img[i+2] = data[i+2];  img[i+3] = 255;  }
			}
			else {
				var smpls = out["t258"]?out["t258"].length : 3;
				if(smpls==4) for(var i=0; i<qarea; i++) img[i] = data[i];
				if(smpls==3) for(var i=0; i< area; i++) {  var qi=i<<2, ti=i*3;  img[qi]=data[ti];  img[qi+1]=data[ti+1];  img[qi+2]=data[ti+2];  img[qi+3]=255;    }
			}
		}
		else  // 3x 16-bit channel
			for(var i=0; i<area; i++) {  var qi=i<<2, ti=i*6;  img[qi]=data[ti];  img[qi+1]=data[ti+2];  img[qi+2]=data[ti+4];  img[qi+3]=255;    }
	}
	else if(intp==3) {
		var map = out["t320"];
		for(var i=0; i<area; i++) {  var qi=i<<2, mi=data[i];  img[qi]=(map[mi]>>8);  img[qi+1]=(map[256+mi]>>8);  img[qi+2]=(map[512+mi]>>8);  img[qi+3]=255;    }
	}
	else if(intp==5) for(var i=0; i<area; i++) {
		var qi=i<<2;  var C=255-data[qi], M=255-data[qi+1], Y=255-data[qi+2], K=(255-data[qi+3])*(1/255);
		img[qi]=Math.round(C*K);  img[qi+1]=Math.round(M*K);  img[qi+2]=Math.round(Y*K);  img[qi+3]=255;
	}
	else log("Unknown Photometric interpretation: "+intp);
	return img;
}

UTIF.replaceIMG = function()
{
	var imgs = document.getElementsByTagName("img");
	for (var i=0; i<imgs.length; i++) {
		var img=imgs[i], src=img.getAttribute("src"), suff=src.split(".").pop().toLowerCase();
		if(suff!="tif" && suff!="tiff") continue;
		var xhr = new XMLHttpRequest();  UTIF._xhrs.push(xhr);  UTIF._imgs.push(img);
		xhr.open("GET", src);  xhr.responseType = "arraybuffer";
		xhr.onload = UTIF._imgLoaded;   xhr.send();
	}
}
UTIF._xhrs = [];  UTIF._imgs = [];
UTIF._imgLoaded = function(e)
{
	var buff = e.target.response;
	var ifds = UTIF.decode(buff), page = ifds[0];  UTIF.decodeImages(buff, ifds);
	var rgba = UTIF.toRGBA8(page), w=page.width, h=page.height;
	var ind = UTIF._xhrs.indexOf(e.target), img = UTIF._imgs[ind];
	UTIF._xhrs.splice(ind,1);  UTIF._imgs.splice(ind,1);
	var cnv = document.createElement("canvas");  cnv.width=w;  cnv.height=h;
	var ctx = cnv.getContext("2d"), imgd = ctx.createImageData(w,h);
	for(var i=0; i<rgba.length; i++) imgd.data[i]=rgba[i];       ctx.putImageData(imgd,0,0);
	var attr = ["style","class","id"];
	for(var i=0; i<attr.length; i++) cnv.setAttribute(attr[i], img.getAttribute(attr[i]));
	img.parentNode.replaceChild(cnv,img);
}


UTIF._binBE = {
	nextZero   : function(data, o) {  while(data[o]!=0) o++;  return o;  },
	readUshort : function(buff, p) {  return (buff[p]<< 8) |  buff[p+1];  },
	readShort  : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+1];  a[1]=buff[p+0];                                    return UTIF._binBE. i16[0];  },
	readInt    : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+3];  a[1]=buff[p+2];  a[2]=buff[p+1];  a[3]=buff[p+0];  return UTIF._binBE. i32[0];  },
	readUint   : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+3];  a[1]=buff[p+2];  a[2]=buff[p+1];  a[3]=buff[p+0];  return UTIF._binBE.ui32[0];  },
	readASCII  : function(buff, p, l) {  var s = "";   for(var i=0; i<l; i++) s += String.fromCharCode(buff[p+i]);   return s; },
	readFloat  : function(buff, p) {  var a=UTIF._binBE.ui8;  for(var i=0;i<4;i++) a[i]=buff[p+3-i];  return UTIF._binBE.fl32[0];  },
	readDouble : function(buff, p) {  var a=UTIF._binBE.ui8;  for(var i=0;i<8;i++) a[i]=buff[p+7-i];  return UTIF._binBE.fl64[0];  },

	writeUshort: function(buff, p, n) {  buff[p] = (n>> 8)&255;  buff[p+1] =  n&255;  },
	writeUint  : function(buff, p, n) {  buff[p] = (n>>24)&255;  buff[p+1] = (n>>16)&255;  buff[p+2] = (n>>8)&255;  buff[p+3] = (n>>0)&255;  },
	writeASCII : function(buff, p, s) {  for(var i = 0; i < s.length; i++)  buff[p+i] = s.charCodeAt(i);  },
	writeDouble: function(buff, p, n) {
		UTIF._binBE.fl64[0] = n;
		for (var i = 0; i < 8; i++) {
	  		buff[p + i] = UTIF._binBE.ui8[7 - i];
		}
	}
}
UTIF._binBE.ui8  = new Uint8Array  (8);
UTIF._binBE.i16  = new Int16Array  (UTIF._binBE.ui8.buffer);
UTIF._binBE.i32  = new Int32Array  (UTIF._binBE.ui8.buffer);
UTIF._binBE.ui32 = new Uint32Array (UTIF._binBE.ui8.buffer);
UTIF._binBE.fl32 = new Float32Array(UTIF._binBE.ui8.buffer);
UTIF._binBE.fl64 = new Float64Array(UTIF._binBE.ui8.buffer);

UTIF._binLE = {
	nextZero   : UTIF._binBE.nextZero,
	readUshort : function(buff, p) {  return (buff[p+1]<< 8) |  buff[p];  },
	readShort  : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+0];  a[1]=buff[p+1];                                    return UTIF._binBE. i16[0];  },
	readInt    : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+0];  a[1]=buff[p+1];  a[2]=buff[p+2];  a[3]=buff[p+3];  return UTIF._binBE. i32[0];  },
	readUint   : function(buff, p) {  var a=UTIF._binBE.ui8;  a[0]=buff[p+0];  a[1]=buff[p+1];  a[2]=buff[p+2];  a[3]=buff[p+3];  return UTIF._binBE.ui32[0];  },
	readASCII  : UTIF._binBE.readASCII,
	readFloat  : function(buff, p) {  var a=UTIF._binBE.ui8;  for(var i=0;i<4;i++) a[i]=buff[p+  i];  return UTIF._binBE.fl32[0];  },
	readDouble : function(buff, p) {  var a=UTIF._binBE.ui8;  for(var i=0;i<8;i++) a[i]=buff[p+  i];  return UTIF._binBE.fl64[0];  }
}
UTIF._copyTile = function(tb, tw, th, b, w, h, xoff, yoff)
{
	//console.log("copyTile", tw, th,  w, h, xoff, yoff);
	var xlim = Math.min(tw, w-xoff);
	var ylim = Math.min(th, h-yoff);
	for(var y=0; y<ylim; y++)
	{
		var tof = (yoff+y)*w+xoff;
		var sof = y*tw;
		for(var x=0; x<xlim; x++) b[tof+x] = tb[sof+x];
	}
}

})(UTIF, pako);
})();
