const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname)));

let waitingVideoUsers = [];
let waitingTextUsers = [];

function clean(socket){
  waitingVideoUsers = waitingVideoUsers.filter(s=>s.id!==socket.id);
  waitingTextUsers = waitingTextUsers.filter(s=>s.id!==socket.id);
}

io.on('connection',(socket)=>{

  socket.on('join',(data={})=>{
    socket.mode = data.mode || 'video';
    clean(socket);

    const list = socket.mode==='video' ? waitingVideoUsers : waitingTextUsers;

    if(list.length>0){
      const partner = list.shift();

      socket.partner = partner;
      partner.partner = socket;

      socket.emit('matched',{partnerId:partner.id});
      partner.emit('matched',{partnerId:socket.id});
    }else{
      list.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('offer',(data)=>{
    if(socket.partner){
      socket.partner.emit('offer',{sdp:data.sdp,senderId:socket.id});
    }
  });

  socket.on('answer',(data)=>{
    if(socket.partner){
      socket.partner.emit('answer',{sdp:data.sdp,senderId:socket.id});
    }
  });

  socket.on('ice-candidate',(data)=>{
    if(socket.partner){
      socket.partner.emit('ice-candidate',{candidate:data.candidate});
    }
  });

  socket.on('message',(data)=>{
    if(socket.partner){
      socket.partner.emit('message',data);
    }
  });

  socket.on('next',()=>{
    clean(socket);

    if(socket.partner){
      socket.partner.emit('partner-left');
      socket.partner.partner=null;
      socket.partner=null;
    }

    socket.emit('join',{mode:socket.mode});
  });

  socket.on('disconnect',()=>{
    clean(socket);

    if(socket.partner){
      socket.partner.emit('partner-left');
      socket.partner.partner=null;
    }
  });
});

server.listen(process.env.PORT || 3000,()=>console.log("Server running"));
