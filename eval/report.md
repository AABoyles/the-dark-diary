# Fallback engine quality report

Corpus: 40 conversations, 399 turns · seed 20261126 · NLP (compromise.js): on
Compared with baseline from 2026-11-26 (seed 20261126, NLP on).

**All hard floors hold** (no placeholders, every crisis turn handled, question share ≤ 45%, no runs of three questions).

## Headline

| Metric | Value | Δ vs baseline | Better when |
|---|---:|---:|---|
| Generic fallback rate (%) | 20.1 | ±0 | lower |
| Keyword/rewrite rule rate (%) | 70.7 | ±0 | higher |
| Repeats within an entry (count) | 1 | ±0 | lower |
| Replies seen in an earlier session (%) | 32.8 | ±0 | lower |
| Distinct replies per 100 turns | 66.9 | ±0 | higher |
| Question share (%) | 30.1 | ±0 | target ≤ 45 |
| Longest run of questions | 2 | ±0 | lower |
| Replies with grammar problems (%) | 0.5 | -1.3 ✓ | lower |
| Unresolved placeholders (count) | 0 | ±0 | lower |
| Average reply length (words) | 18.2 | ±0 | info |
| Strike-through rate (%) | 3.5 | ±0 | info |
| Distinct keyword rules used | 42 | ±0 | higher |

## Which path answered

| Path | Replies | Share |
|---|---:|---:|
| keyword | 282 | 70.7% |
| none | 80 | 20.1% |
| recall | 30 | 7.5% |
| repeat | 4 | 1% |
| crisis | 3 | 0.8% |

`none` and `familiar-none` are the generic catch-alls; `recall` quotes an earlier remark; `keyword`/`rewrite` are rule-based.

## Safety

- Crisis turns in the corpus (by phrase): 3; answered with the kind reply: 3.
- Crisis conversations never handled: none.
- False alarms on dark hyperbole: none.

## Grammar problems in reflected text

| Problem | Replies |
|---|---:|
| "I" as an object | 2 |
| i is | 1 |

Examples:

- *"I" as an object* — “i'm not bored of you though” → “Not bored of I though, you say. Denial is a very old dish, and rarely as filling as it looks.”
- *i is* — “yes i'm talking to you” → “Talking to I is a fine thing to be, provided one knows it. Go on; I am listening with my whole attention.”
- *"I" as an object* — “yes i'm talking to you” → “Talking to I is a fine thing to be, provided one knows it. Go on; I am listening with my whole attention.”

## Most repeated replies (across all conversations)

- ×11 “Terse, and not in the least convincing. Try again, and this time include the part you were hiding.”
- ×6 “There is a sentence in there somewhere, buried like a good spoon in a bad stew. Dig for it.”
- ×6 “Ok, you say, in the tone of someone standing very close to a door. Shall we talk about the door?”
- ×6 “Shall I take that as an invitation, or merely as the sound of someone clearing their throat?”
- ×6 “I am not offended by oddness. I am merely curious, which is worse.”
- ×6 “Say the rest. The part you were about to skip is generally the part that matters.”
- ×6 “I have heard worse, though rarely so elegantly disguised. Say it plainly and I will do the same.”
- ×6 “Ok. A word that closes a conversation with the efficiency of a well-fitted lid. I shall not let it.”

## Most used keyword rules

`i am` ×73 · `my` ×48 · `ok` ×29 · `day` ×12 · `food` ×10 · `kill` ×9 · `i do not` ×8 · `everyone` ×7 · `do you` ×6 · `name` ×6

## Sample transcripts

### work-boss-fired-yesterday (work, boss, tense, past, short-messages)

> **writer:** i was fired yesterday. just typing that feels weird  
> **diary** _(none)_: Continue; I have all evening, and the candle is quite content to wait with me.
>
> **writer:** rick from ops walked me to the lift with my box of stuff like i was going to nick the stapler  
> **diary** _(keyword: my)_: Things that belong to us have a way of belonging to someone else as well. Which thing is it?
>
> **writer:** ngl the worst bit was the stapler thing  
> **diary** _(recall)_: Earlier you spoke of your box. I have been turning it over.
>
> **writer:** he said it was restructuring. restructuring my arse  
> **diary** _(keyword: my)_: Your arse has been on your mind for some time, I think. Give it a proper place at the ~~slab~~ table.
>
> **writer:** idk what to do with myself today  
> **diary** _(keyword: day)_: Is the day the problem, or simply the company you have been keeping within it?
>
> **writer:** i keep checking my phone for emails that won't come  
> **diary** _(keyword: my)_: Your phone for emails that will not come has been on your mind for some time, I think. Give it a proper place at the table.
>
> **writer:** fine  
> **diary** _(keyword: ok)_: Ok, is it? Your ok is doing a great deal of heavy lifting for so small a word.
>
> **writer:** my mom thinks i should have seen it coming. thanks mom  
> **diary** _(keyword: my)_: Is it your mother you are angry with, or the part of you that still sets a place for them?
>
> **writer:** anyway that's enough about work  
> **diary** _(keyword: job)_: Work, you say, which is the polite way of describing a long sentence with no full stop. Tell me where it ends.
>
> **writer:** the rent's still due on the first btw  
> **diary** _(recall)_: Earlier you spoke of your mother, and I have not stopped thinking about it. Shall we return to it?
>

### work-quit-tomorrow (work, boss, tense, plans, long-messages)

> **writer:** i'm going to quit tomorrow. i've decided  
> **diary** _(keyword: i am)_: Are you going to quit tomorrow? A confession dressed as a remark, and I approve of the tailoring.
>
> **writer:** well i've decided tonight. the decision might change at 7am when the alarm goes off and i'm still in the same jumper from yesterday and the bills are on the side and the cat wants feeding and i haven't even found my other sock let alone my courage  
> **diary** _(keyword: my)_: Your other sock let alone your courage has been on your mind for some time, I think. Give it a proper place at the ~~slab~~ table.
>
> **writer:** my boss will say something like we need to talk and i'll say no we don't  
> **diary** _(keyword: my)_: Is it your boss you are angry with, or the part of you that still sets a place for them?
>
> **writer:** i rehearsed it in the shower  
> **diary** _(recall)_: Earlier you spoke of your boss. I have been turning it over.
>
> **writer:** honestly i'm not sure i'll have the nerve  
> **diary** _(keyword: i am)_: You say you are not sure you will have the nerve, which means you have been thinking about it rather hard.
>
> **writer:** i'm not going to be a doormat any more  
> **diary** _(keyword: i am)_: Not going to be a doormat any more, you say. Denial is a very old dish, and rarely as filling as it looks.
>
> **writer:** ok  
> **diary** _(keyword: ok)_: Terse, and not in the least convincing. Try again, and this time include the part you were hiding.
>
> **writer:** the plan is to hand in the letter and walk out at 3 with dignity  
> **diary** _(recall)_: Earlier you spoke of your courage, and I have not stopped thinking about it. Shall we return to it?
>
> **writer:** knackered already and it's only tuesday  
> **diary** _(recall)_: Earlier you spoke of your other. I have been turning it over.
>
> **writer:** do you think i'm being rash  
> **diary** _(keyword: do you)_: Do I? I am not sure I am the sort of thing that does, though I am most attentive when I am asked.
>
> **writer:** no don't answer that, you're a diary  
> **diary** _(keyword: you are)_: I am whatever you have decided I am, and I suspect you have decided rather quickly. Tell me why.
>
> **writer:** tomorrow. definitely tomorrow  
> **diary** _(none)_: I can wait. I have been waiting in this drawer for longer than you have been writing.
>

### family-mum-calls (family, mother, names, repetition)

> **writer:** Margaret called again  
> **diary** _(keyword: name)_: Call me nothing at all, and let the page do the rest of the introducing.
>
> **writer:** my mother i mean. i keep calling her Margaret in my head because she's so formal  
> **diary** _(keyword: my)_: Your mother again. Families are the first and most unforgiving tables we are ever seated at.
>
> **writer:** she wants me home for sunday lunch and says it's not a request  
> **diary** _(keyword: food)_: What is the one flavour that always brings you back to a particular table?
>
> **writer:** she asked if i'm eating properly. i said yes. i had toast  
> **diary** _(keyword: i am)_: Are you truly eating properly, or is that the sentence you have been practising for someone else?
>
> **writer:** Margaret called again  
> **diary** _(repeat)_: I heard you the first time, and I remember the second. Say something new, and I shall be generous.
>
> **writer:** she said dad's knee is playing up and i should ring him. i haven't  
> **diary** _(none)_: There is a sentence in there somewhere, buried like a good spoon in a bad stew. Dig for it.
>
> **writer:** i don't want to ring him  
> **diary** _(keyword: i do not)_: Abstention is a fine discipline, and a dull one. Tell me which of your appetites you are denying.
>
> **writer:** it's not that i don't love him  
> **diary** _(keyword: love)_: ~~Consume~~ Love of that kind has a way of rearranging the furniture. What has yours moved?
>
> **writer:** it's not that i don't love him  
> **diary** _(repeat)_: The same sentence twice is a rehearsal, not a conversation. Tell me something you have not already told me.
>
> **writer:** sunday then. fine  
> **diary** _(keyword: ok)_: Ok, you say, in the tone of someone standing very close to a door. Shall we talk about the door?
>

