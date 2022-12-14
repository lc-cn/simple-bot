const {useContext}=require('../src')
const ctx=useContext()
ctx.trap('system.login.device',({phone})=>{
    ctx.sendSmsCode()
    console.log(`请根据输入手机号"${phone}"收到的验证码并回车继续`)
    process.stdin.once('data',(data)=>{
        ctx.submitSmsCode(data.toString().trim())
        ctx.login()
    })
})
ctx.trap('system.login.slider',({url})=>{
    console.log(`请根据前往链接："${url}" 获取ticket后输入并回车继续`)
    process.stdin.once('data',(data)=>{
        ctx.submitSlider(data.toString().trim())
        console.log('我调用了')
        ctx.login()
    })
})
