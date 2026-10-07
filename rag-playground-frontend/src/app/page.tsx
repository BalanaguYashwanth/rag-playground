"use client"
import Image from "next/image";
import { useState } from "react";
import styles from "./page.module.css";
import { rag_search } from "@/api";

export default function Home() {
  const initialEventStage = { 'type': null, 'stage': null, 'message': null }
  const initialChatData = [{ id: 0, user: '', bot: '' }]
  const [input, setInput] = useState('')
  const [chats, setChats] = useState(initialChatData)
  const [eventStage, setEventStage] = useState(initialEventStage)

  const onSubmit = async () => {
    const current_id = chats.length
    setChats(prev => [...prev, { id: current_id, user: input, bot: '' }])
    try {
      setEventStage(initialEventStage)
      await rag_search(input, (event, data) => {
        try {
          if (event == 'status') {
            if (data?.type == 'tag') setEventStage(data)
            else {
              setChats(prev => {
                const updated = [...prev]
                const lastIndex = updated.length - 1
                updated[lastIndex] = {
                  ...updated[lastIndex],
                  bot: updated[lastIndex].bot + (data?.message ?? '')
                }
                return updated
              })


            }
          } 
        }
        catch (error) {
          console.log('Error occured inside rag search:', error)
          setChats(prev => {
          const updated = [...prev]
          const lastIndex = updated.length - 1
          let last_chat = updated[lastIndex]
          last_chat = {
            ...last_chat,
            bot: 'An error occured'
          }
          updated[lastIndex] = last_chat
          return updated
        })
          }
          
        })
    } catch (error) {
      // const tmp_chats = [...chats]
      // tmp_chats[tmp_chats.length-1].bot = 'An error occured'
      // setChats(tmp_chats)
      // setChats(prev=> [...prev, {id: current_id, user: input, bot:'An error occured'}])

      setChats(prev => {
        const updated = [...prev]
        const lastIndex = updated.length - 1
        let last_chat = updated[lastIndex]
        last_chat = {
          ...last_chat,
          bot: 'An error occured'
        }
        updated[lastIndex] = last_chat
        return updated
      })
      console.log('Error occured:', error)
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Image
          className={styles.logo}
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className={styles.intro}>
          <h1>
            To get started, edit the{" "}
            <code className={styles.code}>page.tsx</code> file.
          </h1>
          <p>
            Looking for a starting point or more instructions? Head over to{" "}
            <a
              href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Templates
            </a>{" "}
            or the{" "}
            <a
              href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learning
            </a>{" "}
            center.
          </p>
        </div>
        <div>
          {chats.map((chat, index) => (
            <div key={`chat-${index}`}>
              <p>{chat.user}</p>
              {chat.id == chats.length - 1 && eventStage.type == 'tag' && <p> {eventStage.message} </p>}
              <p>{chat.bot}</p>
            </div>
          ))}
        </div>
        <div className={styles.ctas}>
          <input placeholder="enter to searh" onChange={(e) => setInput(e.target.value)} />
          <button onClick={onSubmit}>submit</button>
        </div>
      </main>
    </div>
  );
}
