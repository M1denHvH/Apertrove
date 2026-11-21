// Delivery is acknowledged by durable Library registration, independently of
// session assignment and of the SDK's unavailable shutter-to-object identity.
function captureDelivery(result,consumer){
  const ids=[...new Set((result?.observedTransferIds||[]).filter(id=>typeof id==='string'&&id))];
  const receipts=ids.map(id=>consumer.receipt(id)).filter(Boolean);
  if(receipts.some(receipt=>receipt.status==='FAILED'))throw Object.assign(Error('A received camera file could not be registered in the Library.'),{code:'TRANSFER_REGISTRATION_FAILED'});
  const committed=receipts.filter(receipt=>receipt.status==='COMMITTED');
  if(!committed.length)return {...result,confirmation:'UNVERIFIED',deliveryConfirmation:'UNVERIFIED',nativeConfirmation:result?.confirmation||'UNVERIFIED'};
  const files=committed.map(receipt=>({path:receipt.path,transferId:receipt.transferId}));
  return {...result,confirmation:'CONFIRMED',deliveryConfirmation:'CONFIRMED',nativeConfirmation:result?.confirmation||'UNVERIFIED',files,shots:files.length,
    observedTransfers:Math.max(Number(result?.observedTransfers)||0,files.length)};
}
module.exports={captureDelivery};
