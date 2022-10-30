const {useContext}=require('../src')
const ctx=useContext()
ctx.command('hello')
ctx.on('message.private',(e)=>{
    e.reply('hello')
})
