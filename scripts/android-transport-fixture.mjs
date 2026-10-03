import https from "node:https";
import fs from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import selfsigned from "selfsigned";
const cert=await selfsigned.generate([{name:"commonName",value:"Nakama transport fixture"}],{keySize:2048,days:1,algorithm:"sha256"});
const wrong=await selfsigned.generate([{name:"commonName",value:"Wrong fixture identity"}],{keySize:2048,days:1,algorithm:"sha256"});
const counts={primary:0,alternate:0,wrong:0};
const servers=[];
async function listen(name,pems){const server=https.createServer({key:pems.private,cert:pems.cert,minVersion:"TLSv1.2"},(req,res)=>{
 if(req.url==="/api/counts"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(counts));return;}
 const chunks=[];req.on("data",chunk=>chunks.push(chunk));req.on("end",()=>{counts[name]++;if(req.url==="/api/drop"){req.socket.destroy();return;}res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({fixture:name,method:req.method,body:Buffer.concat(chunks).toString()}));});
});server.on("tlsClientError",()=>{});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));servers.push(server);return server.address().port;}
const primary=await listen("primary",cert),alternate=await listen("alternate",cert),wrongPort=await listen("wrong",wrong);
const info={primary,alternate,wrong:wrongPort,pin:new X509Certificate(cert.cert).fingerprint256};
await fs.writeFile("tmp/android-transport-fixture.json",JSON.stringify(info));
console.log(JSON.stringify(info));
process.on("SIGINT",()=>{for(const server of servers)server.close();});
