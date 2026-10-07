import { fetchEventSource } from '@microsoft/fetch-event-source'

const API_URL = process.env.NEXT_PUBLIC_API_URL

export const rag_search = async(
  input: string, 
  onEvent: (event: string, data: any) => void, 
  signal?: AbortSignal
) => {
  try{
  await fetchEventSource(`${API_URL}/rag/search`, {
        method:'POST',
        headers: {'Content-type': 'application/json'},
        body: JSON.stringify({query: input}),
        signal,
        openWhenHidden: true,

        async onopen(res){
          const ct = res.headers.get('content-type') ?? ''
          if (res.ok && ct.startsWith('text/event-stream')) return
           throw new Error(`HTTP ${res.status}`);
        },

        async onmessage(msg){
          if(!msg.data) return
          try{
            onEvent(msg.event || 'message', JSON.parse(msg.data))
          } catch(error){
            console.error('onmessage error:', error);
            throw error;
          }
        },

        onclose(){

        },

        onerror(err){
          throw err
        }

      })

  } catch(error){
    console.log('occured errror',error)
    throw error
  }

}