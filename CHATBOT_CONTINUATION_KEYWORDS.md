# GoPark Chatbot Continuation Keywords

Doc nay dung de tiep tuc cong viec neu mat phien chat.

## Keywords de tim lai

- gopark chatbot smart booking
- Hey GoPark voice mode
- chatbot knowledgebase markdown
- pendingBooking awaiting_booking_details
- user chatbot redirect myBooking
- owner chatbot analytics voice
- admin chatbot data search
- chatbot layer4 jest spec
- markdown table data answer
- chatbot knowledge retrieval local vector
- hybrid router tool data knowledge
- booking conflict resolved main merge

## Files quan trong

- `src/modules/chatbot/chatbot.service.ts`
- `src/modules/chatbot/owner-chatbot.service.ts`
- `src/modules/chatbot/admin-chatbot.service.ts`
- `src/modules/chatbot/admin-chatbot.controller.ts`
- `src/modules/chatbot/chatbot-guide.service.ts`
- `src/modules/chatbot/chatbot-knowledge.service.ts`
- `src/modules/chatbot/chatbot-layer4.spec.ts`
- `src/modules/chatbot/knowledgebase/booking-flow.md`
- `src/modules/chatbot/knowledgebase/response-style.md`
- `src/modules/booking/booking.service.ts`
- FE repo: `src/components/chatbot/user/UserChatbot.tsx`
- FE repo: `src/components/chatbot/owner/OwnerChatbot.tsx`
- FE repo: `src/components/chatbot/admin/AdminChatbot.tsx`
- FE repo: `src/components/features/parking-detail/BookingForm.tsx`

## Trang thai hien tai

- Da merge code moi tu `origin/main` vao BE va FE.
- BE conflict trong `booking.service.ts` da resolve theo flow payment hien tai va giu grace period 15 phut.
- BE `npm test -- --runInBand` pass: 2 suites, 9 tests.
- BE `npm run build` pass.
- FE `npm run build` pass truoc do, can chay lai neu tiep tuc sua UI.

## Luong chatbot dat cho

- User co the noi/nhap `dat bai`, chatbot se hoi tiep thong tin thieu va luu `pendingBooking`.
- Neu user khong nho ten bai, bien so, payment, chatbot goi y lua chon ngan: `bai 1`, `xe 1`, `thanh toan 1`.
- Parser da sua de `bai 1`, `xe 1`, `thanh toan 1` khong bi hieu nham thanh gio `01:00`.
- Khi du thong tin, BE tra ve `action: redirect` toi `/users/myBooking/:parkingLotId?start=...&end=...&vehicle=...&payment=...`.
- Query `vehicle` la bien so xe vi FE `BookingForm` select xe theo `plate_number`.

## Data answers

- User/owner/admin chatbot nen tra loi data bang Markdown table khi phu hop.
- Owner co the hoi `xem thong tin bai`, chatbot liet ke `Bai 1`, `Bai 2`; owner tra loi `bai 1` de xem dung bai.
- Owner co the hoi doanh thu, so sanh, top bai, bai hoat dong kem, goi y tang doanh thu.
- Admin chatbot co endpoint `/api/v1/chatbot/admin`, role ADMIN, dung de tra tong quan, tim user, tim bai, doanh thu, request cho duyet va hoa don chua thanh toan.

## Knowledge retrieval

- `ChatbotKnowledgeService` tao vector noi bo tu README + `knowledgebase/*.md`, chunk theo heading Markdown va tim do lien quan bang cosine similarity.
- Day la lop retrieval local, khong can API embedding. Sau nay co the thay `toVector/search` bang embedding provider that ma van giu flow hien tai.
- `ChatbotService` dung retrieval cho FREE_FORM/huong dan khi khong co Groq key, va dua context lien quan vao system prompt khi co Groq.
- Tool/data/booking van uu tien rule + DB de tranh AI bia so lieu hoac thao tac sai.

## Voice va UI

- User va owner chatbot co wake word `Hey GoPark`.
- User/owner/admin chatbot UI co the phong to/thu nho.
- User voice flow xu ly redirect khi BE tra `action: redirect`.
