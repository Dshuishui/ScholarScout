import { useState, useEffect } from 'react'

export type LegalTab = 'privacy' | 'terms'

interface Props {
  onClose: () => void
  defaultTab?: LegalTab
}

const UPDATED = '2026 年 9 月 15 日'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>
      <div className="text-[13px] text-gray-600 leading-relaxed space-y-1.5">{children}</div>
    </section>
  )
}

function Privacy() {
  return (
    <>
      <Section title="1. 我们保存哪些信息">
        <p><b>账号信息</b>：注册邮箱。密码只保存加盐哈希值，无法还原出明文。</p>
        <p><b>登录后同步的数据</b>：收藏的论文、最近 100 条阅读记录、AI 对话记录（含你上传 PDF 后提取出的文字）、最多 30 条搜索快照、订阅关键词及推送记录。</p>
        <p><b>留言板</b>：留言内容，以及根据你的 IP 查询到的大致城市。IP 地址本身不写入数据库。</p>
        <p><b>服务器日志</b>：Web 服务器会记录访问 IP、时间和请求地址，用于排查故障和防止滥用。</p>
        <p><b>访问统计</b>：使用部署在我们自己服务器上的 Umami 统计页面访问量，不接入第三方广告或跟踪服务。</p>
        <p><b>保存在你浏览器本地的数据</b>：你填写的 DeepSeek API Key、界面偏好设置。</p>
      </Section>
      <Section title="2. 关于你的 API Key">
        <p>搜索时，你的 Key 会随请求发送到我们的服务器，只用于本次调用 DeepSeek，不会被保存。论文对话、多论文分析等功能由你的浏览器直接调用 DeepSeek。</p>
      </Section>
      <Section title="3. 会发送给第三方的信息">
        <p>为提供服务，以下信息会发送给第三方：</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>DeepSeek</b>：你的搜索描述、论文标题和摘要、你在对话中输入的问题和上传 PDF 的文字。使用免费试用额度时，由我们的 Key 代为调用。</li>
          <li><b>学术数据库</b>（arXiv、OpenAlex、Semantic Scholar、PubMed、Europe PMC、Crossref、INSPIRE-HEP 等）和 <b>Unpaywall</b>：由你的描述提取出的检索关键词、论文 DOI。</li>
          <li><b>腾讯 QQ 邮箱</b>：用于发送验证、找回密码和订阅推送邮件（你的邮箱地址和邮件内容）。</li>
          <li><b>ip-api.com</b>：发表留言时，用你的 IP 地址查询所在城市。</li>
        </ul>
        <p>我们不会出售你的个人信息，也不会把它用于广告。</p>
      </Section>
      <Section title="4. 安全">
        <p>我们对密码做哈希处理，修改或重置密码后其他设备上的登录会全部失效，并对登录、注册等接口做了频率限制。</p>
        <p className="text-amber-700"><b>请注意：</b>网站目前通过 HTTP 访问，数据在网络传输过程中没有加密。请不要使用与其他重要账号相同的密码，也尽量避免在不信任的公共网络中登录。</p>
      </Section>
      <Section title="5. 保存期限、导出与删除">
        <p>数据保存在位于中国大陆的云服务器上，保存到你注销账号为止。</p>
        <p>你可以随时在「账号设置」中<b>导出全部数据</b>或<b>注销账号</b>。注销后，账号、收藏、阅读记录、AI 对话、搜索快照和订阅会被删除；留言板上的留言会保留内容，但与账号解除关联，显示为匿名。</p>
        <p>为防止数据丢失，我们可能保留数据库备份，备份中的数据会随备份删除而清除。</p>
      </Section>
      <Section title="6. 联系我们与政策更新">
        <p>对隐私有任何问题，可以通过网站上的留言板联系我们。</p>
        <p>本政策如有更新，会修改页面顶部的更新日期；重大变更会在网站上提示。</p>
      </Section>
    </>
  )
}

function Terms() {
  return (
    <>
      <Section title="1. 服务说明">
        <p>ScholarScout 是免费提供的学术论文检索与 AI 辅助阅读工具，按"现状"提供。我们不保证服务持续可用，也不保证检索结果完整、准确。</p>
      </Section>
      <Section title="2. AI 生成的内容">
        <p>论文摘要、相关性判断、分析和问答由大模型生成，可能出现错误或遗漏，不构成学术、医学、法律等专业意见。引用或做决定前，请核对原文。</p>
      </Section>
      <Section title="3. 账号与 API Key">
        <p>请使用真实可用的邮箱注册，并妥善保管密码和 API Key。使用自己的 API Key 产生的费用，由你与 DeepSeek 自行结算。</p>
      </Section>
      <Section title="4. 合理使用">
        <p>禁止批量抓取数据、攻击或探测系统漏洞、绕过频率限制、滥用免费额度，以及在留言板发布违法、侵权或骚扰内容。违反的，我们可以限制功能或注销相关账号。</p>
      </Section>
      <Section title="5. 第三方内容与版权">
        <p>论文元数据和链接来自第三方学术数据库，论文版权归作者和出版方所有。本站提供的 PDF 下载和外部链接只是为了方便查找公开获取的版本，请遵守你所在地的版权法律和相关网站的条款。我们不对第三方网站的内容负责。</p>
      </Section>
      <Section title="6. 数据来源致谢">
        <p>Thank you to arXiv for use of its open access interoperability.</p>
        <p>感谢 OpenAlex、Semantic Scholar（Ai2）、PubMed / NCBI、Europe PMC、Crossref、INSPIRE-HEP、Unpaywall 提供开放的学术数据接口。</p>
      </Section>
      <Section title="7. 责任限制">
        <p>在法律允许的范围内，对于因使用或无法使用本服务造成的损失，我们不承担责任。</p>
      </Section>
      <Section title="8. 条款变更">
        <p>我们可能更新本条款，更新后会修改页面顶部的日期。更新后继续使用本服务，即表示你接受新的条款。</p>
      </Section>
    </>
  )
}

export function LegalModal({ onClose, defaultTab = 'privacy' }: Props) {
  const [tab, setTab] = useState<LegalTab>(defaultTab)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex gap-4">
            {(['privacy', 'terms'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >{t === 'privacy' ? '隐私政策' : '服务条款'}</button>
            ))}
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <p className="text-xs text-gray-400 mb-4">更新日期：{UPDATED}</p>
          {tab === 'privacy' ? <Privacy /> : <Terms />}
        </div>
      </div>
    </div>
  )
}
