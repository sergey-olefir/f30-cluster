import cv2, numpy as np
ref=cv2.imread('scratchpad/ref_comfort.png')            # panel 1920x720, known coordinates
ph=cv2.imread('images/11.jpg')
g1=cv2.cvtColor(ref,cv2.COLOR_BGR2GRAY); g2=cv2.cvtColor(ph,cv2.COLOR_BGR2GRAY)
cl=cv2.createCLAHE(3.0,(8,8)); g1=cl.apply(g1); g2=cl.apply(g2)
sift=cv2.SIFT_create(6000)
k1,d1=sift.detectAndCompute(g1,None); k2,d2=sift.detectAndCompute(g2,None)
print(len(k1),len(k2))
m=cv2.BFMatcher().knnMatch(d1,d2,k=2)
good=[a for a,b in m if a.distance<0.78*b.distance]
print('good',len(good))
src=np.float32([k1[a.queryIdx].pt for a in good]); dst=np.float32([k2[a.trainIdx].pt for a in good])
H,inl=cv2.findHomography(src,dst,cv2.RANSAC,6.0)
print('inliers',int(inl.sum()))
np.save('scratchpad/H11.npy',H)
# warp the photo into panel space
warp=cv2.warpPerspective(ph,np.linalg.inv(H),(1920,720))
cv2.imwrite('scratchpad/photo11_panel.png',warp)
# overlay for checking: blend
cv2.imwrite('scratchpad/overlay11.png',cv2.addWeighted(warp,0.6,ref,0.6,0))
