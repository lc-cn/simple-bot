const {useContext}=require('../../src')
const ctx=useContext()
ctx.command('test [aaa:string]')
console.log(ctx.disposes)