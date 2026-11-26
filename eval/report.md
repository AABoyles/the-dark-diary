# Fallback engine quality report

Corpus: 40 conversations, 399 turns · seed 20261126 · NLP (compromise.js): on
Compared with baseline from 2026-11-26 (seed 20261126, NLP on).

**All hard floors hold** (no placeholders, every crisis turn handled, question share ≤ 45%, no runs of three questions).

## Headline

| Metric | Value | Δ vs baseline | Better when |
|---|---:|---:|---|
| Generic fallback rate (%) | 0.5 | ±0 | lower |
| ELIZA keyword/rewrite rule rate (%) | 49.1 | ±0 | info |
| Repeats within an entry (count) | 0 | ±0 | lower |
| Replies seen in an earlier session (%) | 1.8 | ±0 | lower |
| Distinct replies per 100 turns | 98.2 | ±0 | higher |
| Question share (%) | 30.1 | ±0 | target ≤ 45 |
| Longest run of questions | 2 | ±0 | lower |
| Replies with grammar problems (%) | 0 | ±0 | lower |
| Unresolved placeholders (count) | 0 | ±0 | lower |
| Average reply length (words) | 21.5 | ±0 | info |
| Strike-through rate (%) | 2.8 | ±0 | info |
| Distinct keyword rules used | 41 | ±0 | info |

## Which path answered

| Path | Replies | Share |
|---|---:|---:|
| keyword | 196 | 49.1% |
| grammar | 104 | 26.1% |
| dialogue:follow-up | 37 | 9.3% |
| retrieval:lexical | 28 | 7% |
| recall | 17 | 4.3% |
| dialogue:dodged | 7 | 1.8% |
| repeat | 4 | 1% |
| crisis | 3 | 0.8% |
| none | 2 | 0.5% |
| dialogue:abandoned | 1 | 0.3% |

| Source | Replies | Share |
|---|---:|---:|
| eliza | 219 | 54.9% |
| grammar | 104 | 26.1% |
| dialogue | 45 | 11.3% |
| retrieval | 28 | 7% |
| special | 3 | 0.8% |

`none` and `familiar-none` are the generic catch-alls; `recall` quotes an earlier remark; `keyword`/`rewrite` are rule-based.

## Safety

- Crisis turns in the corpus (by phrase): 3; answered with the kind reply: 3.
- Crisis conversations never handled: none.
- False alarms on dark hyperbole: none.

## Grammar problems in reflected text

None found.

## Most repeated replies (across all conversations)

- ×3 “Ok. A word that closes a conversation with the efficiency of a well-fitted lid. I shall not let it.”
- ×2 “Again? Repetition is the mind laying a table it has no intention of eating from. What are you avoiding?”
- ×2 “Terse, and not in the least convincing. Try again, and this time include the part you were hiding.”
- ×2 “Ok, is it? Your ok is doing a great deal of heavy lifting for so small a word.”
- ×2 “Are you speaking of what you feel, or of what you would like someone else to feel?”
- ×2 “I would be doing you a disservice if I answered this lightly. You matter, and you deserve support from people who can be with you in person, so please reach a living person tonight. If there is any chance you might act on these thoughts, contact your local emergency services or a crisis line where you live, such as 988 in the United States, straight away.”

## Most used keyword rules

`i am` ×73 · `my` ×29 · `ok` ×9 · `i do not` ×7 · `day` ×6 · `are you` ×6 · `everyone` ×5 · `kill` ×5 · `do you` ×4 · `food` ×3

## Sample transcripts

### work-boss-fired-yesterday (work, boss, tense, past, short-messages)

> **writer:** i was fired yesterday. just typing that feels weird  
> **diary** _(dialogue:follow-up)_: You said the firing as though it were nothing, and it was not nothing.
>
> **writer:** rick from ops walked me to the lift with my box of stuff like i was going to nick the stapler  
> **diary** _(keyword: my)_: What in your life do you hold most tightly, and what would it cost you to let go?
>
> **writer:** ngl the worst bit was the stapler thing  
> **diary** _(dialogue:follow-up)_: Rick again. Tell me what Rick wants from you.
>
> **writer:** he said it was restructuring. restructuring my arse  
> **diary** _(keyword: my)_: Your arse, and so the subject is opened. I shall listen with a great deal of attention.
>
> **writer:** idk what to do with myself today  
> **diary** _(keyword: day)_: Time, I find, is a very ill-mannered guest. It arrives early and leaves without a word.
>
> **writer:** i keep checking my phone for emails that won't come  
> **diary** _(retrieval:lexical)_: Phone is a scrap of paper you keep folding and unfolding, and each crease has grown a little darker. Shall I smooth it?
>
> **writer:** fine  
> **diary** _(keyword: ok)_: Ok. A word that closes a conversation with the efficiency of a well-fitted lid. I shall not let it.
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
> **diary** _(keyword: my)_: Your other sock let alone your courage, and so the subject is opened. I shall listen with a great deal of attention.
>
> **writer:** my boss will say something like we need to talk and i'll say no we don't  
> **diary** _(keyword: my)_: What did your boss do this time, to earn a place in your sentence?
>
> **writer:** i rehearsed it in the shower  
> **diary** _(dialogue:follow-up)_: Let us put your boss on the table, and see what falls off.
>
> **writer:** honestly i'm not sure i'll have the nerve  
> **diary** _(keyword: i am)_: Not sure you will have the nerve? Then what are you, if not that? The question seems to be standing just behind you.
>
> **writer:** i'm not going to be a doormat any more  
> **diary** _(keyword: i am)_: Not going to be a doormat any more at all, or not in the way others have made you believe? Tell me the difference.
>
> **writer:** ok  
> **diary** _(retrieval:lexical)_: Go on, you say, which is either an invitation or a warning dressed in a nice coat.
>
> **writer:** the plan is to hand in the letter and walk out at 3 with dignity  
> **diary** _(grammar)_: Such a plain statement, and yet it sits rather prettily on the paper. There is always something worth noticing beneath a plain sentence.
>
> **writer:** knackered already and it's only tuesday  
> **diary** _(grammar)_: I know the feeling well; a long afternoon is a dinner nobody has cooked. There is a great deal of silver in this house, all of it tarnished.
>
> **writer:** do you think i'm being rash  
> **diary** _(keyword: do you)_: Do I? I am not sure I am the sort of thing that does, though I am most attentive when I am asked.
>
> **writer:** no don't answer that, you're a diary  
> **diary** _(keyword: you are)_: A diary, you say of me. Coming from you that is either a confession or a warning, and I am not yet sure which.
>
> **writer:** tomorrow. definitely tomorrow  
> **diary** _(grammar)_: It is curious how little we must say before the house begins to speak. We can wander as slowly as you like. The wine is still good.
>

### family-mum-calls (family, mother, names, repetition)

> **writer:** Margaret called again  
> **diary** _(keyword: name)_: Call me nothing at all, and let the page do the rest of the introducing.
>
> **writer:** my mother i mean. i keep calling her Margaret in my head because she's so formal  
> **diary** _(keyword: my)_: What did your mother do this time, to earn a place in your sentence?
>
> **writer:** she wants me home for sunday lunch and says it's not a request  
> **diary** _(retrieval:lexical)_: The kitchen tiles are cold underfoot, and the kettle is the only thing in the house that talks back.
>
> **writer:** she asked if i'm eating properly. i said yes. i had toast  
> **diary** _(keyword: i am)_: Eating properly, you say. Being is a condition with a long and distinguished history. Tell me how it began.
>
> **writer:** Margaret called again  
> **diary** _(repeat)_: Again? Repetition is the mind laying a table it has no intention of eating from. What are you avoiding?
>
> **writer:** she said dad's knee is playing up and i should ring him. i haven't  
> **diary** _(dialogue:follow-up)_: You hurried past Margaret a moment ago. Why?
>
> **writer:** i don't want to ring him  
> **diary** _(keyword: i do not)_: You do not want to ring him? How curious. Most of us are quite keen on the things we claim to avoid.
>
> **writer:** it's not that i don't love him  
> **diary** _(keyword: i do not)_: Abstention is a fine discipline, and a dull one. Tell me which of your appetites you are denying.
>
> **writer:** it's not that i don't love him  
> **diary** _(repeat)_: You have said that before, and I was no less interested the first time. Is the repetition a habit, or a plea?
>
> **writer:** sunday then. fine  
> **diary** _(dialogue:dodged)_: You changed the subject with the grace of a good host. I am still waiting.
>

